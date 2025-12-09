require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const axios = require("axios");

const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.tz.setDefault("Asia/Bangkok");

const { OpenAI } = require("openai");

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});
const transcriptCache = {};


const app = express();
const PORT = 3000;

/* ==============================
   ✅ PATH CONFIG
============================== */

const uploadsRoot = path.join(__dirname, "uploads");
const logsRoot = path.join(__dirname, "logs");

if (!fs.existsSync(uploadsRoot)) fs.mkdirSync(uploadsRoot, { recursive: true });
if (!fs.existsSync(logsRoot)) fs.mkdirSync(logsRoot, { recursive: true });

/* ==============================
   ✅ MIDDLEWARE
============================== */
app.use(cors());
app.use(express.json());

// ✅ Serve front-end UI (index.html tự động)
app.use(express.static(path.join(__dirname, "public")));

// ✅ Serve uploaded videos
app.use("/uploads", express.static(uploadsRoot));


/* ==============================
   ✅ LOGGING
============================== */

function writeLog(message) {
    const logPath = path.join(logsRoot, "sessions.log");
    const time = dayjs().format();
    fs.appendFileSync(logPath, `[${time}] ${message}\n`);
}

/* ==============================
   ✅ SAFE FOLDER NAME
============================== */

function sanitizeFolderName(userName) {
    const now = dayjs();
    const safe = (userName || "user")
        .replace(/[^a-z0-9]/gi, "_")
        .toLowerCase();
    return `${now.format("DD_MM_YYYY_HH_mm")}_${safe}`;
}

/* ==============================
   ✅ STT Whisper API
============================== */

async function generateTranscript(videoPath, transcriptPath, qIndex) {
    let attempt = 0;

    while (attempt < 3) {
        try {
            attempt++;

            console.log(`🎤 STT attempt ${attempt} for Q${qIndex}`);

            const audio = fs.createReadStream(videoPath);

            const resp = await openai.audio.transcriptions.create({
                file: audio,
                model: "whisper-1",
                language: "vi",
            });

            const text =
                `===== Question ${qIndex} =====\n` +
                `${resp.text}\n\n`;

            // ✅ LƯU VÀO CACHE – KHÔNG GHI FILE
            transcriptCache[qIndex] = text;

            console.log(`✅ STT SUCCESS Q${qIndex}`);
            return;

        } catch (err) {
            console.error(`❌ STT failed Q${qIndex} attempt ${attempt}:`, err);

            attempt++;

            if (attempt >= 3) {
                transcriptCache[qIndex] =
                    `===== Question ${qIndex} =====\n[STT FAILED]\n\n`;
            }

            await new Promise(r => setTimeout(r, 2000));
        }
    }
}


/* ==============================
   ✅ WEBHOOK
============================== */

async function sendWebhook(meta) {
    try {
        await axios.post("http://your-server/webhook", meta);
        console.log("✅ Webhook sent");
    } catch (e) {
        console.error("❌ Webhook failed:", e.message);
    }
}

/* ==============================
   ✅ VERIFY TOKEN
============================== */

app.post("/api/verify-token", (req, res) => {
    const { token } = req.body;

    if (token === "12345") return res.json({ ok: true });

    return res.status(401).json({ ok: false, message: "Invalid token" });
});

/* ==============================
   ✅ START SESSION
============================== */

app.post("/api/session/start", (req, res) => {
    try {
        const { token, userName } = req.body;

        if (token !== "12345")
            return res.status(401).json({ ok: false, message: "Invalid token" });

        const folder = sanitizeFolderName(userName);
        const folderPath = path.join(uploadsRoot, folder);
        fs.mkdirSync(folderPath, { recursive: true });

        const metadata = {
            user: userName,
            folder,
            startedAt: dayjs().format(),
            uploads: []
        };

        fs.writeFileSync(
            path.join(folderPath, "metadata.json"),
            JSON.stringify(metadata, null, 2)
        );

        const transcriptPath = path.join(folderPath, "transcript.txt");
        fs.writeFileSync(transcriptPath, "");

        writeLog(`Session START: ${folder}`);

        return res.json({ ok: true, folder });
    } catch (err) {
        return res.status(500).json({ ok: false, message: err.message });
    }
});

/* ==============================
   ✅ UPLOAD CONFIG
============================== */

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const folder = req.body.folder;
        const dest = path.join(uploadsRoot, folder);
        fs.mkdirSync(dest, { recursive: true });
        cb(null, dest);
    },
    filename: (req, file, cb) => {
        cb(null, `Q${req.body.questionIndex}.webm`);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 50 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype !== "video/webm")
            return cb(new Error("Invalid file type"));
        cb(null, true);
    }
});

/* ==============================
   ✅ UPLOAD ONE QUESTION (NON-BLOCKING)
============================== */

app.post("/api/upload-one", upload.single("file"), (req, res) => {
    try {
        const { token, folder, questionIndex } = req.body;

        if (token !== "12345")
            return res.status(401).json({ ok: false, message: "Invalid token" });

        if (!req.file)
            return res.status(400).json({ ok: false, message: "No file uploaded" });

        const folderPath = path.join(uploadsRoot, folder);
        const metaPath = path.join(folderPath, "metadata.json");

        const metadata = JSON.parse(fs.readFileSync(metaPath));

        metadata.uploads.push({
            question: Number(questionIndex),
            savedAs: req.file.filename,
            uploadedAt: dayjs().format()
        });

        fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));

        // ✅ Run STT in the background → do NOT block UI
        const transcriptPath = path.join(folderPath, "transcript.txt");

        setTimeout(() => {
            generateTranscript(
                path.join(folderPath, req.file.filename),
                transcriptPath,
                questionIndex
            );
        }, 0);

        // ✅ Return immediately so UI reaches 100%
        return res.json({
            ok: true,
            savedAs: req.file.filename
        });

    } catch (err) {
        return res.status(500).json({ ok: false, message: err.message });
    }
});


/* ==============================
   ✅ FINISH SESSION
============================== */

app.post("/api/session/finish", (req, res) => {
    try {
        const { token, folder, questionsCount } = req.body;

        if (token !== "12345")
            return res.status(401).json({ ok: false, message: "Invalid token" });

        const folderPath = path.join(uploadsRoot, folder);
        const metaPath = path.join(folderPath, "metadata.json");

        const metadata = JSON.parse(fs.readFileSync(metaPath));

        metadata.finishedAt = dayjs().format();
        metadata.questionsCount = questionsCount;

        fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));

        // ✅ ======== GHI TRANSCRIPT CHỈ KHI FINISH =========
        const transcriptPath = path.join(folderPath, "transcript.txt");

        let finalText = "";

        // ✅ ghi đúng thứ tự câu
        for (let i = 1; i <= questionsCount; i++) {
            finalText +=
                `===== Question ${i} =====\n` +
                `${transcriptCache[i] || "[NO TRANSCRIPT]\n"}\n\n`;
        }

        fs.writeFileSync(transcriptPath, finalText);

        // ✅ clear cache để tránh rò rỉ dữ liệu
        Object.keys(transcriptCache).forEach(k => delete transcriptCache[k]);

        // ===============================================

        writeLog(`Session FINISH: ${folder}`);

        sendWebhook(metadata);

        return res.json({ ok: true });

    } catch (err) {
        return res.status(500).json({ ok: false, message: err.message });
    }
});


/* ==============================
   ✅ HEALTHCHECK
============================== */

app.get("/api/health", (req, res) => res.json({ ok: true }));

/* ==============================
   ✅ SPA FALLBACK
============================== */

app.use((req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
})


/* ==============================
   ✅ START SERVER
============================== */

app.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
});
