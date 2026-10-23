import 'dotenv/config';
import mongoose from 'mongoose';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';

const runDump = async () => {
  console.log('--- 1. Connecting to MongoDB ---');
  const mongoUrl = process.env.MONGO_URL;
  await mongoose.connect(mongoUrl);
  console.log('Connected to MongoDB database:', mongoose.connection.name);

  // Fetch Users
  const usersCollection = mongoose.connection.db.collection('users');
  const allUsers = await usersCollection.find().toArray();
  const userMap = new Map();
  allUsers.forEach((u) => {
    userMap.set(u._id.toString(), u.name || u.email || 'User');
  });
  console.log(`Loaded ${allUsers.length} users.`);

  // Fetch Proforma Invoices
  const piCollection = mongoose.connection.db.collection('proformainvoices');
  const allInvoices = await piCollection.find().sort({ createdAt: 1 }).toArray();
  console.log(`Loaded ${allInvoices.length} proforma invoices from DB.`);

  // Fetch Settings
  const settingsCollection = mongoose.connection.db.collection('settings');
  const settingsList = await settingsCollection.find().toArray();
  console.log(`Loaded ${settingsList.length} settings document(s).`);

  console.log('\n--- 2. Connecting to Google Sheets ---');
  const sheetId = (process.env.GOOGLE_SHEET_ID || '').trim();
  const email = (process.env.GOOGLE_CLIENT_EMAIL || '').trim();
  const key = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

  const auth = new JWT({
    email,
    key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const doc = new GoogleSpreadsheet(sheetId, auth);
  await doc.loadInfo();
  console.log(`Connected to Google Spreadsheet: "${doc.title}"`);
  console.log(`Existing Sheets:`, doc.sheetsByIndex.map((s, idx) => `[${idx}] ${s.title}`));

  // --- 3. Dump Proforma Invoices to Sheet2 ---
  console.log('\n--- 3. Dumping Invoices to Sheet2 ---');
  let invoiceSheet = doc.sheetsByTitle['Sheet2'] || doc.sheetsByIndex[1];
  if (!invoiceSheet) {
    invoiceSheet = await doc.addSheet({ title: 'Sheet2' });
  }

  const invoiceHeaders = [
    'invoiceNumber',
    'customerName',
    'address',
    'subtotal',
    'cgst',
    'sgst',
    'grandTotal',
    'invoiceDate',
    'dueDate',
    'serviceItems',
    'paymentStatus',
    'paidAmount',
    'pendingBalance',
    'paymentMode',
    'transactionId',
    'createdBy',
  ];

  await invoiceSheet.setHeaderRow(invoiceHeaders);

  // Clear all rows in a single batch API call
  try {
    await invoiceSheet.clearRows();
    console.log('Cleared existing rows in Sheet2 in 1 batch call.');
  } catch (clearErr) {
    console.log('No rows to clear or clearRows error:', clearErr.message);
  }

  // Helper for services formatting
  const formatServices = (items) => {
    if (!Array.isArray(items) || items.length === 0) return '';
    return items
      .map((item) => {
        const desc = (item.description || '').trim();
        if (!desc) return null;
        const amt = Number(item.amount);
        if (!isNaN(amt) && amt > 0) {
          return `${desc} (₹${amt.toLocaleString('en-IN')})`;
        }
        return desc;
      })
      .filter(Boolean)
      .join(', ');
  };

  const formattedInvoices = allInvoices.map((inv) => {
    const fullAddress = [
      inv.customer?.address,
      inv.customer?.city,
      inv.customer?.state,
      inv.customer?.pincode,
    ]
      .filter(Boolean)
      .join(', ');

    const gTotal = Number(inv.grandTotal || 0);

    let paidAmt = 0;
    let paymentModesList = [];
    let txnIdsList = [];

    if (Array.isArray(inv.installments) && inv.installments.length > 0) {
      paidAmt = inv.installments.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
      paymentModesList = inv.installments.map((item) => item.paymentMode).filter(Boolean);
      txnIdsList = inv.installments.map((item) => item.transactionId).filter(Boolean);
    } else if (inv.paidAmount != null && inv.paidAmount !== '') {
      paidAmt = Number(inv.paidAmount);
    } else if (inv.paymentStatus === 'Paid') {
      paidAmt = gTotal;
    } else if (inv.paidPercentage != null) {
      paidAmt = (gTotal * (Number(inv.paidPercentage) || 0)) / 100;
    }

    const pendBal = Math.max(0, gTotal - paidAmt);

    let statusStr = 'Pending';
    if (inv.paymentStatus === 'Paid' || (gTotal > 0 && pendBal <= 0 && paidAmt >= gTotal)) {
      statusStr = 'Fully Paid';
    } else if (inv.paymentStatus === 'Partial' || paidAmt > 0) {
      statusStr = 'Partial Payment';
    }

    const paymentMode =
      [...new Set(paymentModesList)].join(', ') ||
      inv.paymentMode ||
      (paidAmt > 0 ? 'Cash' : '-');

    const transactionId =
      [...new Set(txnIdsList)].join(', ') ||
      inv.transactionId ||
      '-';

    let creatorName = '';
    if (inv.createdBy) {
      const cId = inv.createdBy._id ? inv.createdBy._id.toString() : inv.createdBy.toString();
      creatorName = userMap.get(cId) || inv.createdBy.name || inv.createdBy.email || '';
    }

    return {
      invoiceNumber: inv.invoiceNumber || '',
      customerName: inv.customer?.customerName || '',
      address: fullAddress,
      subtotal: inv.subtotal != null ? inv.subtotal : 0,
      cgst: inv.cgst != null ? inv.cgst : 0,
      sgst: inv.sgst != null ? inv.sgst : 0,
      grandTotal: gTotal,
      invoiceDate: inv.invoiceDate || '',
      dueDate: inv.dueDate || '',
      serviceItems: formatServices(inv.items),
      paymentStatus: statusStr,
      paidAmount: paidAmt,
      pendingBalance: pendBal,
      paymentMode: paymentMode,
      transactionId: transactionId,
      createdBy: creatorName,
    };
  });

  console.log(`Adding ${formattedInvoices.length} invoices to Sheet2 in 1 batch call...`);
  await invoiceSheet.addRows(formattedInvoices);
  console.log(`Successfully dumped ${formattedInvoices.length} invoices into Sheet2!`);

  // --- 4. Dump Users Collection to Users Sheet ---
  console.log('\n--- 4. Dumping Users Collection ---');
  let usersSheet = doc.sheetsByTitle['Users'];
  if (!usersSheet) {
    usersSheet = await doc.addSheet({ title: 'Users' });
  }
  const userHeaders = ['userId', 'name', 'email', 'role', 'createdAt'];
  await usersSheet.setHeaderRow(userHeaders);

  try {
    await usersSheet.clearRows();
  } catch (e) {}

  const formattedUsers = allUsers.map((u) => ({
    userId: u._id.toString(),
    name: u.name || '',
    email: u.email || '',
    role: u.role || 'User',
    createdAt: u.createdAt ? new Date(u.createdAt).toISOString() : '',
  }));

  await usersSheet.addRows(formattedUsers);
  console.log(`Successfully dumped ${formattedUsers.length} users into "Users" sheet!`);

  // --- 5. Dump Settings Collection to Settings Sheet ---
  console.log('\n--- 5. Dumping Settings Collection ---');
  let settingsSheet = doc.sheetsByTitle['CompanySettings'];
  if (!settingsSheet) {
    settingsSheet = await doc.addSheet({ title: 'CompanySettings' });
  }
  const settingsHeaders = ['field', 'value'];
  await settingsSheet.setHeaderRow(settingsHeaders);

  try {
    await settingsSheet.clearRows();
  } catch (e) {}

  const settingsRows = [];
  if (settingsList.length > 0) {
    const s = settingsList[0];
    settingsRows.push({ field: 'Company Email', value: s.email || '' });
    settingsRows.push({ field: 'Phone', value: s.phone || '' });
    settingsRows.push({ field: 'Website', value: s.website || '' });
    settingsRows.push({ field: 'Address', value: s.address || '' });
    settingsRows.push({ field: 'GSTIN', value: s.gstin || '' });
    settingsRows.push({ field: 'PAN', value: s.pan || '' });
    settingsRows.push({ field: 'Bank Name', value: s.bankName || '' });
    settingsRows.push({ field: 'Account Number', value: s.accountNumber || '' });
    settingsRows.push({ field: 'IFSC Code', value: s.ifscCode || '' });
    settingsRows.push({ field: 'Branch', value: s.branch || '' });
    if (Array.isArray(s.terms)) {
      settingsRows.push({ field: 'Terms & Conditions', value: s.terms.join(' | ') });
    }
  }

  await settingsSheet.addRows(settingsRows);
  console.log(`Successfully dumped ${settingsRows.length} settings fields into "CompanySettings" sheet!`);

  console.log('\n=============================================');
  console.log('ALL DATABASE DATA SUCCESSFULLY DUMPED TO GOOGLE SHEET!');
  console.log(`Spreadsheet URL: https://docs.google.com/spreadsheets/d/${sheetId}/edit`);
  console.log('=============================================');

  await mongoose.disconnect();
};

runDump().catch((err) => {
  console.error('Error during DB dump:', err);
  process.exit(1);
});
