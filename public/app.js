// ================== CONFIG ==================
const BASE = "http://localhost:3000";
const API = {
    start: `${BASE}/api/session/start`,
    upload: `${BASE}/api/upload-one`,
    finish: `${BASE}/api/session/finish`
  };
// ================== QUESTIONS ==================

// Question lists
const QUESTIONS = [
  "Tell me about yourself.",
  "What interests you about our company?",
  "What is the most challenging model you’ve deployed and why?",
  "How do you detect and handle data drift in a live ML system?",
  "When would you choose a simpler model over a complex one?"
];

// ================== DOM ==================
const els = {
  token: document.getElementById("token"),
  startBtn: document.getElementById("startBtn"),
  nextBtn: document.getElementById("nextBtn"),
  finishBtn: document.getElementById("finishBtn"),
  retryBtn: document.getElementById("retryBtn"),
  uploadStatus: document.getElementById("uploadStatus"),
  interview: document.getElementById("interview"),
  playbackSection: document.getElementById("playbackSection"),
  videoGrid: document.getElementById("videoGrid"),
  video: document.getElementById("previewVideo"),
  questionText: document.getElementById("questionText"),
  startContainer: document.getElementById("start-container")
};

// ================== STATE ==================
let folder = null;
let currentQuestion = 1;
let mediaRecorder = null;
let mediaStream = null;
let chunks = [];
let currentBlob = null;

// ================== HELPERS ==================
async function postJSON(url, data) {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  }).then(res => {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  });
}


function uploadBlob(q, blob) {
  return new Promise((resolve, reject) => {

      const xhr = new XMLHttpRequest();
      const progressFill = document.getElementById("progressFill");

      const form = new FormData();
      form.append("token", els.token.value);
      form.append("folder", folder);
      form.append("questionIndex", q);
      form.append("file", blob, `Q${q}.webm`);

      xhr.open("POST", API.upload, true);

      xhr.upload.onprogress = (e) => {
          if (!e.lengthComputable) return;

          const percent = Math.round((e.loaded / e.total) * 100);
          progressFill.style.width = percent + "%";
          els.uploadStatus.textContent = `📤 Uploading ${percent}%`;
      };

      xhr.onload = () => {
          console.log("✅ Upload response:", xhr.responseText);

          if (xhr.status === 200) {
              progressFill.style.width = "100%";
              els.uploadStatus.textContent = "✅ Upload succeeds!";

              // ✅ FIX: ensure UI moves to next question
              resolve(JSON.parse(xhr.responseText));
          } else {
              progressFill.style.width = "0%";
              els.uploadStatus.textContent = "❌ Upload error!";
              reject(new Error("Server error"));
          }
      };

      xhr.onerror = () => {
          progressFill.style.width = "0%";
          els.uploadStatus.textContent = "❌ Network error!";
          reject(new Error("Network error"));
      };

      xhr.send(form);
  });
}



function updateUIQuestion() {
  els.questionText.textContent =
    `Question ${currentQuestion}: ${QUESTIONS[currentQuestion - 1]}`;
}

// ================== RECORDING CONTROL ==================
function startRecording() {
  chunks = [];
  currentBlob = null;

  mediaRecorder.start();
  els.uploadStatus.textContent = "Recording...";
}

function stopRecording() {
    return new Promise(resolve => {
      mediaRecorder.onstop = () => {
        currentBlob = new Blob(chunks, { type: "video/webm" });
        const sizeMB = currentBlob.size / 1024 / 1024;

        if (sizeMB > 40) {
         els.uploadStatus.textContent = `⚠️ File too large (${sizeMB.toFixed(1)} MB), try shorter answer`;
}

        resolve();
      };
      mediaRecorder.stop();
      els.uploadStatus.textContent = "⏹️ Stopped recording, preparing to upload...";

    });
  }



// ================== START SESSION ==================
els.startBtn.addEventListener("click", async () => {
    try {
      // Request session
      const out = await postJSON(API.start, {
        token: els.token.value,
        userName: "guest"
      });

      folder = out.folder;

        // Show/Hide UI
      els.startContainer.style.display = "none";
      els.interview.style.display = "block";

      updateUIQuestion();

      // ===============================
      // ✅ Access CAMERA + MICRO (with try/catch)
      // ===============================
      try {
        mediaStream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true
        });
      } catch (err) {
        console.error("Cannot access the camera:", err);
        alert("Cannot access camera/micro: " + err.message);
        return;
      }

      // ===============================
      // ✅ SHOW PREVIEW
      // ===============================
      els.video.srcObject = mediaStream;

      // ===============================
      // ✅ RESET CHUNKS
      // ===============================
      chunks = [];

      // ✅ MIME type
      const options = { mimeType: "video/webm; codecs=vp8,opus" };


      // ✅ Create MediaRecorder
      try {
        mediaRecorder = new MediaRecorder(mediaStream, options);
      } catch (err) {
        console.error("MediaRecorder error:", err);
        alert("The browser does not support MediaRecorder with this MIME.");
        return;
      }

      // ✅ Get recorded video data
      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          chunks.push(e.data);
        }
      };

      // ✅ Auto record question 1 after 400ms
      setTimeout(() => {
        startRecording();
        els.nextBtn.disabled = false;
      }, 400);

    } catch (err) {
      alert("Cannot begin session: " + err.message);
    }
  });


// ================== NEXT ==================
els.nextBtn.addEventListener("click", async () => {
  els.nextBtn.disabled = true;

  els.uploadStatus.textContent = `Processing question ${currentQuestion}...`;

  await stopRecording();

  try {
      await uploadBlob(currentQuestion, currentBlob);
      els.uploadStatus.textContent = "✅ Upload successful!";
  } catch (err) {
      els.uploadStatus.textContent = "❌ Upload fail!";
      els.retryBtn.style.display = "inline-block";
      return;
  }

  currentQuestion++;

  if (currentQuestion > QUESTIONS.length) {
      els.uploadStatus.textContent = "Finished";
      els.nextBtn.style.display = "none";
      els.finishBtn.style.display = "inline-block";

      mediaStream.getTracks().forEach(t => t.stop());
      return;
  }

  updateUIQuestion();
  els.uploadStatus.textContent = "✓ Saved. Ready for next question...";

  setTimeout(() => {
      startRecording();

      // ✅ FIX: enable button immediately
      els.nextBtn.disabled = false;
  }, 300);
});


// ================== FINISH ==================
els.finishBtn.addEventListener("click", async () => {
  els.finishBtn.disabled = true;
  els.finishBtn.textContent = "Processing...";

  await postJSON(API.finish, {
    token: els.token.value,
    folder,
    questionsCount: QUESTIONS.length
});


  // Show playback
  els.interview.style.display = "none";
  els.playbackSection.style.display = "block";

  for (let i = 1; i <= QUESTIONS.length; i++) {
    const wrap = document.createElement("div");
    wrap.style.border = "1px solid #475569";
    wrap.style.padding = "10px";
    wrap.style.borderRadius = "10px";

    const title = document.createElement("p");
    title.textContent = `Câu ${i}: ${QUESTIONS[i - 1]}`;
    title.style.color = "#fcd34d";
    title.style.fontWeight = "bold";

    const v = document.createElement("video");
    v.src = `${BASE}/uploads/${folder}/Q${i}.webm`;
    v.controls = true;
    v.style.width = "100%";
    v.style.borderRadius = "8px";

    wrap.appendChild(title);
    wrap.appendChild(v);
    els.videoGrid.appendChild(wrap);
  }
});
els.retryBtn.addEventListener("click", async () => {
    els.retryBtn.style.display = "none";

    let attempt = 0;

    async function tryUpload() {
        try {
            els.uploadStatus.textContent = `♻️ Retry attempt ${attempt + 1}`;
            await uploadBlob(currentQuestion, currentBlob);
            els.uploadStatus.textContent = "✅ Upload successful!";
        } catch (err) {
            attempt++;

            if (attempt >= 3) {
                els.uploadStatus.textContent = "❌ Upload failed after 3 retries";
                els.retryBtn.style.display = "inline-block";
                return;
            }

            const wait = Math.pow(2, attempt) * 1000; // 1s,2s,4s
            els.uploadStatus.textContent = `⏳ Retry in ${wait / 1000}s...`;

            await new Promise(r => setTimeout(r, wait));
            return tryUpload();
        }
    }

    tryUpload();
});

