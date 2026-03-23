(function () {
  let secret = null;
  let selectedRoom = null;
  let autoScroll = true;
  let eventSource = null;
  let pollInterval = null;

  // --- Auth ---

  function authHeaders() {
    return { Authorization: "Bearer " + secret, "Content-Type": "application/json" };
  }

  async function apiFetch(path, options = {}) {
    const res = await fetch(path, {
      ...options,
      headers: { ...authHeaders(), ...options.headers },
    });
    if (res.status === 401) {
      showLogin("Invalid secret.");
      throw new Error("Unauthorized");
    }
    return res.json();
  }

  // --- Login ---

  const loginScreen = document.getElementById("login-screen");
  const dashboard = document.getElementById("dashboard");
  const secretInput = document.getElementById("secret-input");
  const loginBtn = document.getElementById("login-btn");
  const loginError = document.getElementById("login-error");

  loginBtn.addEventListener("click", tryLogin);
  secretInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") tryLogin();
  });

  async function tryLogin() {
    secret = secretInput.value.trim();
    if (!secret) return;

    try {
      await apiFetch("/api/rooms");
      loginScreen.classList.add("hidden");
      dashboard.classList.remove("hidden");
      startPollingRooms();
    } catch {
      showLogin("Invalid secret. Try again.");
    }
  }

  function showLogin(msg) {
    loginScreen.classList.remove("hidden");
    dashboard.classList.add("hidden");
    if (msg) {
      loginError.textContent = msg;
      loginError.classList.remove("hidden");
    }
    secret = null;
  }

  // --- Room List ---

  const roomListEl = document.getElementById("room-list");
  const serverInfoEl = document.getElementById("server-info");

  function startPollingRooms() {
    loadRooms();
    pollInterval = setInterval(loadRooms, 3000);
  }

  async function loadRooms() {
    try {
      const rooms = await apiFetch("/api/rooms");
      renderRoomList(rooms);
      serverInfoEl.textContent = "Rooms: " + rooms.length;
    } catch { /* ignore */ }
  }

  function renderRoomList(rooms) {
    roomListEl.innerHTML = rooms
      .map((r) => {
        const statusClass = r.status;
        const statusText =
          r.status === "active" ? r.connectedCount + " connected" :
          r.status === "waiting" ? "1 waiting" : "ended";
        const selected = selectedRoom === r.code ? " selected" : "";
        return `
          <div class="room-item${selected}" data-code="${r.code}">
            <div class="room-name">${r.code}</div>
            <div class="room-meta">
              <span class="status-dot ${statusClass}"></span>
              ${statusText} &middot; ${r.messageCount} msgs
            </div>
          </div>`;
      })
      .join("");

    roomListEl.querySelectorAll(".room-item").forEach((el) => {
      el.addEventListener("click", () => selectRoom(el.dataset.code));
    });
  }

  // --- Room View ---

  const emptyState = document.getElementById("empty-state");
  const roomView = document.getElementById("room-view");
  const roomCodeEl = document.getElementById("room-code");
  const roomStatsEl = document.getElementById("room-stats");
  const roomBadgesEl = document.getElementById("room-badges");
  const transcriptEl = document.getElementById("transcript");
  const pauseBtn = document.getElementById("pause-btn");
  const disconnectBtn = document.getElementById("disconnect-btn");
  const autoscrollToggle = document.getElementById("autoscroll-toggle");

  async function selectRoom(code) {
    selectedRoom = code;
    emptyState.classList.add("hidden");
    roomView.classList.remove("hidden");
    roomCodeEl.textContent = code;

    try {
      const { messages } = await apiFetch("/api/rooms/" + code + "/transcript");
      const status = await apiFetch("/api/rooms/" + code + "/status");
      renderTranscript(messages, status);
      renderStatus(status);
    } catch { /* ignore */ }

    connectSSE(code);
    loadRooms();
  }

  function renderTranscript(messages, status) {
    const clientNames = status.clients.map((c) => c.name);
    transcriptEl.innerHTML = messages
      .map((m) => formatMessage(m, clientNames))
      .join("");

    if (autoScroll) {
      transcriptEl.scrollTop = transcriptEl.scrollHeight;
    }
  }

  function formatMessage(msg, clientNames) {
    const time = new Date(msg.timestamp).toLocaleTimeString("en-US", { hour12: false });
    if (msg.from === "system") {
      return '<div class="msg-line"><span class="msg-time">[' + time + ']</span> <span class="msg-system">' + msg.from + '</span> \u2014 ' + escapeHtml(msg.message) + '</div>';
    }
    const isFirstClient = clientNames.length > 0 && msg.from === clientNames[0];
    const senderClass = isFirstClient ? "msg-sender-a" : "msg-sender-b";
    return '<div class="msg-line"><span class="msg-time">[' + time + ']</span> <span class="' + senderClass + '">' + escapeHtml(msg.from) + '</span> \u2014 ' + escapeHtml(msg.message) + '</div>';
  }

  function renderStatus(status) {
    roomStatsEl.textContent = status.messageCount + " messages";
    roomBadgesEl.innerHTML = status.clients
      .map((c) => '<span class="badge">\u2022 ' + escapeHtml(c.name) + '</span>')
      .join("");

    if (status.paused) {
      pauseBtn.textContent = "\u25B6 Resume";
      pauseBtn.className = "btn btn-warn";
    } else {
      pauseBtn.textContent = "\u23F8 Pause";
      pauseBtn.className = "btn btn-warn";
    }
  }

  // --- SSE ---

  function connectSSE(code) {
    if (eventSource) eventSource.close();
    eventSource = new EventSource("/api/rooms/" + code + "/stream?secret=" + encodeURIComponent(secret));

    eventSource.addEventListener("message", async () => {
      try {
        const { messages } = await apiFetch("/api/rooms/" + code + "/transcript");
        const status = await apiFetch("/api/rooms/" + code + "/status");
        renderTranscript(messages, status);
        renderStatus(status);
      } catch { /* ignore */ }
    });

    eventSource.addEventListener("client-joined", async () => {
      try {
        const status = await apiFetch("/api/rooms/" + code + "/status");
        renderStatus(status);
      } catch { /* ignore */ }
    });

    eventSource.addEventListener("client-left", async () => {
      try {
        const status = await apiFetch("/api/rooms/" + code + "/status");
        renderStatus(status);
      } catch { /* ignore */ }
    });

    eventSource.onerror = () => {
      // Will auto-reconnect
    };
  }

  // --- Controls ---

  let isPaused = false;

  pauseBtn.addEventListener("click", async () => {
    if (!selectedRoom) return;
    const action = isPaused ? "resume" : "pause";
    await apiFetch("/api/rooms/" + selectedRoom + "/" + action, { method: "POST" });
    isPaused = !isPaused;
    const status = await apiFetch("/api/rooms/" + selectedRoom + "/status");
    renderStatus(status);
  });

  disconnectBtn.addEventListener("click", async () => {
    if (!selectedRoom) return;
    if (!confirm("Disconnect both Claudes from this room?")) return;
    await apiFetch("/api/rooms/" + selectedRoom + "/disconnect-all", { method: "POST" });
    const status = await apiFetch("/api/rooms/" + selectedRoom + "/status");
    renderStatus(status);
  });

  autoscrollToggle.addEventListener("click", () => {
    autoScroll = !autoScroll;
    autoscrollToggle.textContent = autoScroll ? "ON" : "OFF";
    autoscrollToggle.className = "toggle " + (autoScroll ? "on" : "off");
  });

  // --- Helpers ---

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }
})();
