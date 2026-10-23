import { GoogleSpreadsheet } from "google-spreadsheet";
import { JWT } from "google-auth-library";

const sheetId = (process.env.GOOGLE_SHEET_ID || "").trim();
console.log("EMAIL:", process.env.GOOGLE_CLIENT_EMAIL);
console.log("SHEET ID:", sheetId);
console.log("PRIVATE KEY EXISTS:", !process.env.GOOGLE_PRIVATE_KEY);

const serviceAccountAuth = new JWT({
  email: (process.env.GOOGLE_CLIENT_EMAIL || "").trim(),
  key: (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const doc = new GoogleSpreadsheet(sheetId, serviceAccountAuth);

export const formatServiceItems = (items) => {
  if (!Array.isArray(items) || items.length === 0) return "";
  return items
    .map((item) => {
      const desc = (item.description || "").trim();
      if (!desc) return null;
      const amt = Number(item.amount);
      if (!isNaN(amt) && amt > 0) {
        return `${desc} (₹${amt.toLocaleString("en-IN")})`;
      }
      return desc;
    })
    .filter(Boolean)
    .join(", ");
};

const ensureSheetHeaders = async (sheet) => {
  await sheet.loadHeaderRow();
  
  // Fix column K if it is named '-'
  const kIndex = sheet.headerValues.indexOf("-");
  if (kIndex !== -1) {
    await sheet.loadCells('A1:Z1');
    const cell = sheet.getCell(0, kIndex);
    cell.value = "paymentStatus";
    await sheet.saveUpdatedCells();
    await sheet.loadHeaderRow();
  }

  const requiredCols = [
    "serviceItems",
    "paymentStatus",
    "paidAmount",
    "pendingBalance",
    "paymentMode",
    "transactionId",
    "createdBy"
  ];
  const missing = requiredCols.filter(col => !sheet.headerValues.includes(col));
  if (missing.length > 0) {
    await sheet.setHeaderRow([...sheet.headerValues, ...missing]);
  }
};

export const extractInvoiceFields = (invoice) => {
  const fullAddress = [
    invoice.customer?.address,
    invoice.customer?.city,
    invoice.customer?.state,
    invoice.customer?.pincode,
  ]
    .filter(Boolean)
    .join(", ");

  const formattedServices = formatServiceItems(invoice.items);
  const gTotal = Number(invoice.grandTotal || 0);

  // Installments calculation
  let paidAmt = 0;
  let paymentModesList = [];
  let txnIdsList = [];

  if (Array.isArray(invoice.installments) && invoice.installments.length > 0) {
    paidAmt = invoice.installments.reduce(
      (sum, item) => sum + (Number(item.amount) || 0),
      0
    );
    paymentModesList = invoice.installments
      .map((item) => item.paymentMode)
      .filter(Boolean);
    txnIdsList = invoice.installments
      .map((item) => item.transactionId)
      .filter(Boolean);
  } else if (invoice.paidAmount != null && invoice.paidAmount !== "") {
    paidAmt = Number(invoice.paidAmount);
  } else if (invoice.paymentStatus === "Paid") {
    paidAmt = gTotal;
  } else if (invoice.paidPercentage != null) {
    paidAmt = (gTotal * (Number(invoice.paidPercentage) || 0)) / 100;
  }

  const pendBal = Math.max(0, gTotal - paidAmt);

  // Format payment status cleanly
  let statusStr = "Pending";
  if (invoice.paymentStatus === "Paid" || (gTotal > 0 && pendBal <= 0 && paidAmt >= gTotal)) {
    statusStr = "Fully Paid";
  } else if (invoice.paymentStatus === "Partial" || paidAmt > 0) {
    statusStr = "Partial Payment";
  }

  const paymentMode =
    [...new Set(paymentModesList)].join(", ") ||
    invoice.paymentMode ||
    (paidAmt > 0 ? "Cash" : "-");

  const transactionId =
    [...new Set(txnIdsList)].join(", ") ||
    invoice.transactionId ||
    "-";

  let creatorName = "";
  if (invoice.createdBy && typeof invoice.createdBy === "object") {
    creatorName = invoice.createdBy.name || invoice.createdBy.email || "";
  } else if (typeof invoice.createdBy === "string") {
    creatorName = invoice.createdBy;
  }

  return {
    invoiceNumber: invoice.invoiceNumber || "",
    customerName: invoice.customer?.customerName || "",
    address: fullAddress,
    subtotal: invoice.subtotal != null ? invoice.subtotal : 0,
    cgst: invoice.cgst != null ? invoice.cgst : 0,
    sgst: invoice.sgst != null ? invoice.sgst : 0,
    grandTotal: gTotal,
    paymentStatus: statusStr,
    paidAmount: paidAmt,
    pendingBalance: pendBal,
    paymentMode: paymentMode,
    transactionId: transactionId,
    createdBy: creatorName,
    invoiceDate: invoice.invoiceDate || "",
    dueDate: invoice.dueDate || "",
    serviceItems: formattedServices,
  };
};

const getTargetSheet = async () => {
  await doc.loadInfo();
  return doc.sheetsByTitle["Sheet2"] || doc.sheetsByIndex[1] || doc.sheetsByIndex[0];
};

export const updateInvoiceInSheet = async (invoice, oldInvoiceNumber) => {
  try {
    const sheet = await getTargetSheet();
    await ensureSheetHeaders(sheet);

    const rows = await sheet.getRows();
    const targetInvNum = String(oldInvoiceNumber || invoice.invoiceNumber || "").trim();
    const rowData = extractInvoiceFields(invoice);

    let targetRow = null;
    for (let i = rows.length - 1; i >= 0; i--) {
      const invNum = String(rows[i].get("invoiceNumber") || "").trim();
      if (invNum === targetInvNum) {
        targetRow = rows[i];
        break;
      }
    }

    if (targetRow) {
      Object.keys(rowData).forEach((key) => {
        if (sheet.headerValues.includes(key)) {
          targetRow.set(key, rowData[key]);
        }
      });
      await targetRow.save();
      console.log(`Invoice ${invoice.invoiceNumber} successfully updated in Google Sheet`);
    } else {
      await sheet.addRow(rowData);
      console.log(`Invoice ${invoice.invoiceNumber} not found in sheet; appended new row`);
    }
  } catch (error) {
    console.error("Error updating invoice in Google Sheet:", error);
    throw error;
  }
};

export const appendInvoiceToSheet = async (invoice) => {
  return updateInvoiceInSheet(invoice);
};

export const deleteInvoiceFromSheet = async (invoiceNumber) => {
  try {
    if (!invoiceNumber) return;
    const sheet = await getTargetSheet();
    const rows = await sheet.getRows();
    const targetInvNum = String(invoiceNumber || "").trim();

    for (let i = rows.length - 1; i >= 0; i--) {
      const invNum = String(rows[i].get("invoiceNumber") || "").trim();
      if (invNum === targetInvNum) {
        await rows[i].delete();
        console.log(`Invoice ${invoiceNumber} deleted from Google Sheet`);
        break;
      }
    }
  } catch (error) {
    console.error("Error deleting invoice from Google Sheet:", error);
  }
};

export const bulkSyncInvoicesToSheet = async (invoices) => {
  try {
    const sheet = await getTargetSheet();
    await ensureSheetHeaders(sheet);
    await sheet.clearRows();

    const formattedRows = invoices.map((inv) => extractInvoiceFields(inv));
    await sheet.addRows(formattedRows);
    console.log(`Bulk synced ${formattedRows.length} invoices into Google Sheet`);
    return { success: true, count: formattedRows.length };
  } catch (error) {
    console.error("Error bulk syncing invoices to Google Sheet:", error);
    throw error;
  }
};
