import express from "express";
import cors from "cors";
import path from "path";
import tjenesterRouter from "./routes/tjenester";
import chatRouter from "./routes/chat";
import { ensureDataFile } from "./repository/tjenesterRepo";

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: process.env.NODE_ENV === "production" 
    ? undefined 
    : "http://localhost:5173",
  credentials: true,
}));
app.use(express.json());

// API routes
app.use("/api/tjenester", tjenesterRouter);
app.use("/api/chat", chatRouter);

// In production, serve static files from client/dist
if (process.env.NODE_ENV === "production") {
  const clientDist = path.resolve(__dirname, "../../client/dist");
  app.use(express.static(clientDist));
  
  // Serve React app for all non-API routes
  app.get("*", (req, res) => {
    // Don't serve index.html for API routes
    if (req.path.startsWith("/api/")) {
      return res.status(404).json({ error: "Not found" });
    }
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

// Initialize data file on startup
ensureDataFile()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
      if (process.env.NODE_ENV !== "production") {
        console.log(`API available at http://localhost:${PORT}/api/tjenester`);
      }
    });
  })
  .catch((error) => {
    console.error("Failed to initialize data file:", error);
    process.exit(1);
  });

