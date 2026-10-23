// import "dotenv/config";
// import express from "express";
// import mongoose, { mongo } from "mongoose";
// import path from "path";
// import { fileURLToPath } from "url";
// import crypto from "crypto";
// import cors from "cors";
// import bodyParser from "body-parser";
// import http from "http";
// import contactRoutes from "./routes/contactRoutes.js";
// import fileUpload from "express-fileupload";

// const app = express();
// // dotenv.config();

// const __filename = fileURLToPath(import.meta.url);
// const __dirname = path.dirname(__filename);

// app.set("view engine", "ejs");
// app.set("views", path.join(__dirname, "views"));
// app.use(express.static(path.join(__dirname, "public")));

// app.use(express.json());
// app.use(express.urlencoded({ extended: true }));

// const allowedOrigins = [
//   "https://digitaleliteservices.in",
//   "http://localhost:5173",
//   "http://localhost:5174",
//   "http://localhost:3000"
// ];

// // const allowedOrigins = ["http://localhost:5173"];
// // const allowedOrigins = ["http://localhost:5175", "http://localhost:5174"];

// app.use(
//   cors({
//     origin: function (origin, callback) {
//       if (!origin || allowedOrigins.includes(origin)) {
//         callback(null, true);
//       } else {
//         callback(new Error("Not allowed by CORS"));
//       }
//     },
//     credentials: true, // Allow cookies and authentication headers
//   })
// );

// app.use(express.static("public"));
// // Configure express-fileupload; enable temp files so Cloudinary can access them.
// app.use(
//   fileUpload({
//     useTempFiles: true,
//     tempFileDir: "/tmp/",
//   })
// );

// const MONGO_URL = "mongodb://localhost:27017/";

// // const MONGO_URL =
// //   "mongodb+srv://enquiry:cWkQzlp42pu8yu7N@cluster0.r9w8y.mongodb.net";

// mongoose
//   .connect(MONGO_URL)
//   .then(() => console.log("MongoDB connected"))
//   .catch((err) => console.error("MongoDB connection error", err));

// app.use("/", contactRoutes);

// //app.use("/digitaleliteservice", digitalEliteRoutes);
// const PORT = 5000;
// // const PORT = 3000;

// app.listen(PORT, () => {
//   console.log(`Server is running on http://localhost:${PORT}`);
// });

import "dotenv/config";
import express from "express";
import mongoose from "mongoose";
import path from "path";
import { fileURLToPath } from "url";
import cors from "cors";
import fileUpload from "express-fileupload";
import contactRoutes from "./routes/contactRoutes.js";
import PIRoutes from "./routes/PIRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import pdfRoutes from "./routes/pdfRoutes.js";

const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ======================
// View Engine
// ======================
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// ======================
// Static Files
// ======================
app.use(express.static(path.join(__dirname, "public")));
app.use(express.static("public"));

// ======================
// CORS Configuration
// ======================
app.use(
  cors({
    origin: [
      //  "http://localhost:5173",
      // "http://localhost:5174",
      // "http://localhost:3000",
      "https://digitaleliteservices.in",
      "https://pigenerator.digitaleliteservices.in",
    ],
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);
console.log("Mongo URL:", process.env.MONGO_URL);

// ======================
// Body Parser Limits
// ======================
app.use(
  express.json({
    limit: "50mb",
  }),
);

app.use(
  express.urlencoded({
    extended: true,
    limit: "50mb",
  }),
);

// ======================
// File Upload
// ======================
app.use(
  fileUpload({
    useTempFiles: true,
    tempFileDir: "/tmp/",
    limits: {
      fileSize: 50 * 1024 * 1024, // 50 MB
    },
    abortOnLimit: true,
  }),
);

// ======================
// Test Route
// ======================
app.get("/test", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Backend working successfully",
  });
});

// ======================
// MongoDB Connection
// ======================
const MONGO_URL =
  process.env.MONGO_URL || "mongodb://localhost:27017/invoiceDB";

mongoose
  .connect(MONGO_URL)
  .then(() => {
    console.log("MongoDB connected");
  })
  .catch((err) => {
    console.error("MongoDB connection error:", err);
  });

// ======================
// Routes
// ======================
app.use("/", contactRoutes);
app.use("/", PIRoutes);
app.use("/api/auth", authRoutes);
app.use("/", pdfRoutes);


// app.use("/", authRoutes);
// ======================
// Global Error Handler
// ======================
app.use((err, req, res, next) => {
  console.error("SERVER ERROR:", err);

  res.status(500).json({
    success: false,
    message: err.message || "Internal Server Error",
  });
});

// ======================
// Start Server
// ======================
// const PORT =  5000;
const PORT = 9500;

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
