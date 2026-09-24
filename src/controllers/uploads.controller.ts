import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import express, { type Request, type Response, Router } from "express";
import multer from "multer";

const uploadRoot = path.join(process.cwd(), "uploads", "partner-documents");
const vehicleImageRoot = path.join(process.cwd(), "uploads", "vehicle-images");
const companyLogoRoot = path.join(process.cwd(), "uploads", "company-logos");
const recoveryAttachmentRoot = path.join(process.cwd(), "uploads", "recovery-attachments");
const userAvatarRoot = path.join(process.cwd(), "uploads", "user-avatars");
fs.mkdirSync(uploadRoot, { recursive: true });
fs.mkdirSync(vehicleImageRoot, { recursive: true });
fs.mkdirSync(companyLogoRoot, { recursive: true });
fs.mkdirSync(recoveryAttachmentRoot, { recursive: true });
fs.mkdirSync(userAvatarRoot, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadRoot),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || "";
    cb(null, `${randomUUID()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok =
      file.mimetype === "application/pdf" ||
      file.mimetype.startsWith("image/") ||
      file.mimetype === "application/msword" ||
      file.mimetype ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    if (ok) cb(null, true);
    else cb(new Error("Unsupported file type"));
  }
});

export const uploadsRouter = Router();

function publicBaseUrl(req: Request): string {
  const fromEnv = process.env.PUBLIC_API_URL?.replace(/\/$/, "");
  if (fromEnv) return fromEnv;
  const host = req.get("host") ?? "localhost:4000";
  return `${req.protocol}://${host}`;
}

uploadsRouter.post("/uploads/partner-documents", (req: Request, res: Response) => {
  upload.single("file")(req, res, (err: unknown) => {
    if (err) {
      const msg = err instanceof Error ? err.message : "Upload failed";
      const status =
        err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
      res.status(status).json({ error: msg });
      return;
    }
    const file = (req as Request & { file?: Express.Multer.File }).file;
    if (!file) {
      res.status(400).json({ error: "No file" });
      return;
    }
    const base = publicBaseUrl(req);
    const fileUrl = `${base}/api/uploads/partner-documents/${encodeURIComponent(file.filename)}`;
    res.json({
      fileUrl,
      fileName: file.originalname,
      mimeType: file.mimetype
    });
  });
});

uploadsRouter.use(
  "/uploads/partner-documents",
  express.static(uploadRoot, { index: false })
);

const vehicleImageStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, vehicleImageRoot),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || "";
    cb(null, `${randomUUID()}${ext}`);
  }
});

const uploadVehicleImage = multer({
  storage: vehicleImageStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only image files are allowed"));
  }
});

uploadsRouter.post("/uploads/vehicle-images", (req: Request, res: Response) => {
  uploadVehicleImage.single("file")(req, res, (err: unknown) => {
    if (err) {
      const msg = err instanceof Error ? err.message : "Upload failed";
      const status =
        err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
      res.status(status).json({ error: msg });
      return;
    }
    const file = (req as Request & { file?: Express.Multer.File }).file;
    if (!file) {
      res.status(400).json({ error: "No file" });
      return;
    }
    const base = publicBaseUrl(req);
    const fileUrl = `${base}/api/uploads/vehicle-images/${encodeURIComponent(file.filename)}`;
    res.json({
      fileUrl,
      fileName: file.originalname,
      mimeType: file.mimetype
    });
  });
});

uploadsRouter.use("/uploads/vehicle-images", express.static(vehicleImageRoot, { index: false }));

const companyLogoStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, companyLogoRoot),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || "";
    cb(null, `${randomUUID()}${ext}`);
  }
});

const uploadCompanyLogo = multer({
  storage: companyLogoStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only image files are allowed"));
  }
});

uploadsRouter.post("/uploads/company-logos", (req: Request, res: Response) => {
  uploadCompanyLogo.single("file")(req, res, (err: unknown) => {
    if (err) {
      const msg = err instanceof Error ? err.message : "Upload failed";
      const status =
        err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
      res.status(status).json({ error: msg });
      return;
    }
    const file = (req as Request & { file?: Express.Multer.File }).file;
    if (!file) {
      res.status(400).json({ error: "No file" });
      return;
    }
    const base = publicBaseUrl(req);
    const fileUrl = `${base}/api/uploads/company-logos/${encodeURIComponent(file.filename)}`;
    res.json({
      fileUrl,
      fileName: file.originalname,
      mimeType: file.mimetype
    });
  });
});

uploadsRouter.use("/uploads/company-logos", express.static(companyLogoRoot, { index: false }));

const userAvatarStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, userAvatarRoot),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || "";
    cb(null, `${randomUUID()}${ext}`);
  }
});

const uploadUserAvatar = multer({
  storage: userAvatarStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only image files are allowed"));
  }
});

uploadsRouter.post("/uploads/user-avatars", (req: Request, res: Response) => {
  uploadUserAvatar.single("file")(req, res, (err: unknown) => {
    if (err) {
      const msg = err instanceof Error ? err.message : "Upload failed";
      const status = err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
      res.status(status).json({ error: msg });
      return;
    }
    const file = (req as Request & { file?: Express.Multer.File }).file;
    if (!file) {
      res.status(400).json({ error: "No file" });
      return;
    }
    const base = publicBaseUrl(req);
    const fileUrl = `${base}/api/uploads/user-avatars/${encodeURIComponent(file.filename)}`;
    res.json({
      fileUrl,
      fileName: file.originalname,
      mimeType: file.mimetype
    });
  });
});

uploadsRouter.use("/uploads/user-avatars", express.static(userAvatarRoot, { index: false }));

const recoveryAttachmentStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, recoveryAttachmentRoot),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || "";
    cb(null, `${randomUUID()}${ext}`);
  }
});

const uploadRecoveryAttachment = multer({
  storage: recoveryAttachmentStorage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = file.mimetype.startsWith("image/") || file.mimetype === "application/pdf";
    if (ok) cb(null, true);
    else cb(new Error("Only image/PDF files are allowed"));
  }
});

uploadsRouter.post("/uploads/recovery-attachments", (req: Request, res: Response) => {
  uploadRecoveryAttachment.single("file")(req, res, (err: unknown) => {
    if (err) {
      const msg = err instanceof Error ? err.message : "Upload failed";
      const status = err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
      res.status(status).json({ error: msg });
      return;
    }
    const file = (req as Request & { file?: Express.Multer.File }).file;
    if (!file) {
      res.status(400).json({ error: "No file" });
      return;
    }
    const base = publicBaseUrl(req);
    const fileUrl = `${base}/api/uploads/recovery-attachments/${encodeURIComponent(file.filename)}`;
    res.json({
      fileUrl,
      fileName: file.originalname,
      mimeType: file.mimetype
    });
  });
});

uploadsRouter.use("/uploads/recovery-attachments", express.static(recoveryAttachmentRoot, { index: false }));
