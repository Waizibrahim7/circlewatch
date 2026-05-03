const state = {
  mode: "create",
  roomId: new URLSearchParams(location.search).get("room") || "",
  memberId: localStorage.getItem("circlewatch.memberId") || crypto.randomUUID(),
  color: localStorage.getItem("circlewatch.color") || "#2563eb",
  status: "safe",
  sharing: false,
  watchId: null,
  lastLocation: null,
  source: null,
  markers: new Map()
};

localStorage.setItem("circlewatch.memberId", state.memberId);

const els = {
  setupPanel: document.querySelector("#setupPanel"),
  profilePanel: document.querySelector("#profilePanel"),
  membersPanel: document.querySelector("#membersPanel"),
  createTab: document.querySelector("#createTab"),
  joinTab: document.querySelector("#joinTab"),
  circleName: document.querySelector("#circleName"),
  joinCodeWrap: document.querySelector("#joinCodeWrap"),
  joinCode: document.querySelector("#joinCode"),
  setupBtn: document.querySelector("#setupBtn"),
  roomName: document.querySelector("#roomName"),
  inviteCode: document.querySelector("#inviteCode"),
  copyInviteBtn: document.querySelector("#copyInviteBtn"),
  memberName: document.querySelector("#memberName"),
  message: document.querySelector("#message"),
  shareToggle: document.querySelector("#shareToggle"),
  checkInBtn: document.querySelector("#checkInBtn"),
  smsInvite: document.querySelector("#smsInvite"),
  membersList: document.querySelector("#membersList"),
  memberCount: document.querySelector("#memberCount"),
  mapTitle: document.querySelector("#mapTitle"),
  mapSubtitle: document.querySelector("#mapSubtitle"),
  toast: document.querySelector("#toast")
};

els.memberName.value = localStorage.getItem("circlewatch.name") || "";

const map = L.map("map", { zoomControl: false }).setView([20.5937, 78.9629], 5);
L.control.zoom({ position: "bottomright" }).addTo(map);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap contributors"
}).addTo(map);

function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => els.toast.classList.remove("show"), 2600);
}

function api(path, options = {}) {
  return fetch(path, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {})
    }
  }).then(async response => {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Request failed");
    return data;
  });
}

function setMode(mode) {
  state.mode = mode;
  els.createTab.classList.toggle("active", mode === "create");
  els.joinTab.classList.toggle("active", mode === "join");
  els.joinCodeWrap.classList.toggle("hidden", mode !== "join");
  els.circleName.parentElement.classList.toggle("hidden", mode !== "create");
  els.setupBtn.textContent = mode === "create" ? "Create circle" : "Join circle";
}

function inviteUrl() {
  return `${location.origin}${location.pathname}?room=${state.roomId}`;
}

function showApp(room) {
  state.roomId = room.id;
  history.replaceState(null, "", `?room=${room.id}`);
  els.setupPanel.classList.add("hidden");
  els.profilePanel.classList.remove("hidden");
  els.membersPanel.classList.remove("hidden");
  els.roomName.textContent = room.name;
  els.inviteCode.textContent = room.id;
  els.smsInvite.href = `sms:?&body=${encodeURIComponent(`Join my CircleWatch family safety circle: ${inviteUrl()}`)}`;
  els.mapTitle.textContent = room.name;
  els.mapSubtitle.textContent = "Waiting for live check-ins";
  connectEvents();
  renderRoom(room);
}

function markerIcon(member) {
  const statusRing = member.status === "help" ? "#dc2626" : member.status === "moving" ? "#d97706" : "#059669";
  return L.divIcon({
    className: "",
    html: `<div style="width:28px;height:28px;border-radius:50%;background:${member.color};border:4px solid ${statusRing};box-shadow:0 8px 18px rgba(0,0,0,.26)"></div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14]
  });
}

function timeAgo(ms) {
  const seconds = Math.max(1, Math.round((Date.now() - ms) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

function renderRoom(room) {
  const members = room.members.slice().sort((a, b) => b.lastSeen - a.lastSeen);
  els.memberCount.textContent = String(members.length);
  els.membersList.innerHTML = members.length ? "" : `<div class="member-meta">No one is sharing yet.</div>`;

  for (const member of members) {
    const card = document.createElement("article");
    card.className = "member-card";
    card.innerHTML = `
      <div class="member-main">
        <div class="member-name"><span class="dot" style="--dot:${member.color}"></span><span>${escapeHtml(member.name)}</span></div>
        <div class="member-meta">${member.location ? `${timeAgo(member.location.updatedAt)} · ${Math.round(member.location.accuracy || 0)}m accuracy` : "Location paused"}</div>
        ${member.message ? `<div class="member-message">${escapeHtml(member.message)}</div>` : ""}
      </div>
      <span class="badge ${member.status}">${member.status.toUpperCase()}</span>
    `;
    els.membersList.appendChild(card);
  }

  const bounds = [];
  const seen = new Set();
  for (const member of members) {
    if (!member.location) continue;
    seen.add(member.id);
    const latLng = [member.location.lat, member.location.lng];
    bounds.push(latLng);
    const popup = `<strong>${escapeHtml(member.name)}</strong><br>${member.status.toUpperCase()} · ${timeAgo(member.location.updatedAt)}${member.message ? `<br>${escapeHtml(member.message)}` : ""}`;
    if (!state.markers.has(member.id)) {
      state.markers.set(member.id, L.marker(latLng, { icon: markerIcon(member) }).addTo(map));
    }
    state.markers.get(member.id).setLatLng(latLng).setIcon(markerIcon(member)).bindPopup(popup);
  }

  for (const [id, marker] of state.markers.entries()) {
    if (!seen.has(id)) {
      marker.remove();
      state.markers.delete(id);
    }
  }

  if (bounds.length) {
    map.fitBounds(bounds, { padding: [60, 60], maxZoom: 15 });
    els.mapSubtitle.textContent = `${bounds.length} live location${bounds.length === 1 ? "" : "s"} visible`;
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

function connectEvents() {
  if (state.source) state.source.close();
  state.source = new EventSource(`/api/rooms/${state.roomId}/events`);
  state.source.onmessage = event => {
    const data = JSON.parse(event.data);
    if (data.type === "room") renderRoom(data.room);
  };
  state.source.onerror = () => {
    els.mapSubtitle.textContent = "Reconnecting...";
  };
}

async function publishMember() {
  const name = els.memberName.value.trim() || "Loved one";
  localStorage.setItem("circlewatch.name", name);
  localStorage.setItem("circlewatch.color", state.color);
  const battery = navigator.getBattery ? await navigator.getBattery().then(b => Math.round(b.level * 100)).catch(() => null) : null;
  await api(`/api/rooms/${state.roomId}/members`, {
    method: "POST",
    body: JSON.stringify({
      id: state.memberId,
      name,
      color: state.color,
      status: state.status,
      message: els.message.value,
      battery,
      consent: state.sharing,
      location: state.lastLocation
    })
  });
}

function setSharing(enabled) {
  if (enabled && !navigator.geolocation) {
    toast("This browser does not support location sharing.");
    return;
  }

  state.sharing = enabled;
  els.shareToggle.setAttribute("aria-pressed", String(enabled));

  if (!enabled) {
    if (state.watchId !== null) navigator.geolocation.clearWatch(state.watchId);
    state.watchId = null;
    state.lastLocation = null;
    publishMember().catch(err => toast(err.message));
    return;
  }

  state.watchId = navigator.geolocation.watchPosition(position => {
    state.lastLocation = {
      lat: position.coords.latitude,
      lng: position.coords.longitude,
      accuracy: position.coords.accuracy,
      speed: position.coords.speed || 0
    };
    publishMember().catch(err => toast(err.message));
  }, error => {
    setSharing(false);
    toast(error.message || "Location permission was blocked.");
  }, {
    enableHighAccuracy: true,
    maximumAge: 5000,
    timeout: 12000
  });
}

els.createTab.addEventListener("click", () => setMode("create"));
els.joinTab.addEventListener("click", () => setMode("join"));

els.setupBtn.addEventListener("click", async () => {
  try {
    if (state.mode === "create") {
      const { room } = await api("/api/rooms", {
        method: "POST",
        body: JSON.stringify({ name: els.circleName.value })
      });
      showApp(room);
      toast("Circle created. Share the invite link.");
      return;
    }
    const code = els.joinCode.value.trim().toLowerCase();
    const { room } = await api(`/api/rooms/${code}`);
    showApp(room);
    toast("Joined circle.");
  } catch (err) {
    toast(err.message);
  }
});

els.copyInviteBtn.addEventListener("click", async () => {
  await navigator.clipboard.writeText(inviteUrl());
  toast("Invite link copied.");
});

els.shareToggle.addEventListener("click", () => setSharing(!state.sharing));
els.checkInBtn.addEventListener("click", () => publishMember().then(() => toast("Checked in.")).catch(err => toast(err.message)));

document.querySelectorAll(".swatch").forEach(button => {
  button.classList.toggle("active", button.dataset.color === state.color);
  button.addEventListener("click", () => {
    state.color = button.dataset.color;
    document.querySelectorAll(".swatch").forEach(item => item.classList.toggle("active", item === button));
    publishMember().catch(() => {});
  });
});

document.querySelectorAll(".status-btn").forEach(button => {
  button.addEventListener("click", () => {
    state.status = button.dataset.status;
    document.querySelectorAll(".status-btn").forEach(item => item.classList.toggle("active", item === button));
    publishMember().catch(err => toast(err.message));
  });
});

if (state.roomId) {
  api(`/api/rooms/${state.roomId}`)
    .then(({ room }) => showApp(room))
    .catch(() => {
      state.roomId = "";
      history.replaceState(null, "", location.pathname);
      toast("Invite code expired or was not found.");
    });
}
