import { useState, useEffect, useRef, useCallback } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
});

const WS_URL =
  import.meta.env.VITE_WS_URL || "wss://live-map-ka2s.onrender.com";

function idToColor(id) {
  const colors = [
    "#FF6B6B",
    "#4ECDC4",
    "#45B7D1",
    "#96CEB4",
    "#FFEAA7",
    "#DDA0DD",
    "#98D8C8",
    "#F7DC6F",
    "#BB8FCE",
    "#85C1E9",
    "#82E0AA",
    "#F0B27A",
  ];
  let hash = 0;
  for (let i = 0; i < id.length; i++)
    hash = id.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

export default function App() {
  const [myId, setMyId] = useState(null);
  const [users, setUsers] = useState([]);
  const [myCoords, setMyCoords] = useState(null);
  const [wsStatus, setWsStatus] = useState("connecting");
  const [geoError, setGeoError] = useState(null);

  const wsRef = useRef(null);
  const mapRef = useRef(null);
  const leafletMapRef = useRef(null);
  const markersRef = useRef({});
  const hasPannedRef = useRef(false);

  const sendLocation = useCallback((lat, lng) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "location", lat, lng }));
    }
  }, []);

  useEffect(() => {
    let destroyed = false;
    let ws;
    const connect = () => {
      if (destroyed) return;
      ws = new WebSocket(WS_URL);
      wsRef.current = ws;
      ws.onopen = () => setWsStatus("connected");
      ws.onclose = () => {
        setWsStatus("disconnected");
        setTimeout(connect, 3000);
      };
      ws.onerror = () => setWsStatus("error");
      ws.onmessage = (e) => {
        const d = JSON.parse(e.data);
        if (d.type === "your_id") setMyId(d.id);
        if (d.type === "users") setUsers(d.users);
      };
    };
    connect();
    return () => {
      destroyed = true;
      ws?.close();
    };
  }, []);

  useEffect(() => {
    if (!navigator.geolocation) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setGeoError("Geolocation not supported by this browser.");
      return;
    }

    const opts = { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 };

    const onSuccess = (pos) => {
      setGeoError(null);
      const { latitude: lat, longitude: lng } = pos.coords;
      setMyCoords({ lat, lng });
      sendLocation(lat, lng);
    };

    const onError = (err) => {
      const messages = {
        1: "Permission denied. Click the lock 🔒 in the address bar → allow location → reload.",
        2: "Position unavailable. Enable Location in your OS settings.",
        3: "Request timed out. Move to a better signal area and reload.",
      };
      setGeoError(messages[err.code] || err.message);
    };

    navigator.geolocation.getCurrentPosition(onSuccess, onError, opts);
    const watcher = navigator.geolocation.watchPosition(
      onSuccess,
      onError,
      opts,
    );
    return () => navigator.geolocation.clearWatch(watcher);
  }, [sendLocation]);

  // ── Leaflet Map Init ─────────────────────────────────────────
  useEffect(() => {
    if (!mapRef.current || leafletMapRef.current) return;

    const map = L.map(mapRef.current, { zoomControl: true }).setView(
      [20, 0],
      2,
    );
    L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      {
        //attribution: "&copy; Esri &copy; OpenStreetMap",
        maxZoom: 19,
      },
    ).addTo(map);

    // Nomes de ruas e cidades por cima do satelite
    L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
      {
        maxZoom: 19,
        opacity: 0.8,
      },
    ).addTo(map);

    leafletMapRef.current = map;
  }, []);

  // ── Update Markers ───────────────────────────────────────────
  useEffect(() => {
    const map = leafletMapRef.current;
    if (!map) return;

    const currentIds = new Set(users.map((u) => u.id));

    // Remove stale markers
    Object.keys(markersRef.current).forEach((id) => {
      if (!currentIds.has(id)) {
        markersRef.current[id].remove();
        delete markersRef.current[id];
      }
    });

    // Add / update markers
    users.forEach((user) => {
      if (user.lat == null || user.lng == null) return;
      const isMe = user.id === myId;
      const color = idToColor(user.id);
      const size = isMe ? 22 : 14;

      const icon = L.divIcon({
        className: "",
        html: `<div style="
          width:${size}px;height:${size}px;
          background:${color};border-radius:50%;
          border:${isMe ? "3px solid white" : "2px solid rgba(255,255,255,0.5)"};
          box-shadow:0 0 ${isMe ? 14 : 6}px ${color};
          ${isMe ? "animation:pulse 2s infinite;" : ""}
        "></div>`,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
      });

      if (markersRef.current[user.id]) {
        markersRef.current[user.id].setLatLng([user.lat, user.lng]);
        markersRef.current[user.id].setIcon(icon);
      } else {
        markersRef.current[user.id] = L.marker([user.lat, user.lng], { icon })
          .addTo(map)
          .bindPopup(
            `<b>${isMe ? "You" : "User"}</b><br><code>${user.lat.toFixed(5)}, ${user.lng.toFixed(5)}</code>`,
          );
      }
    });

    // Pan to self only once on first fix
    if (myCoords && !hasPannedRef.current) {
      hasPannedRef.current = true;
      map.setView([myCoords.lat, myCoords.lng], 13);
    }
  }, [users, myId, myCoords]);

  const wsColor = {
    connected: "#4ECDC4",
    disconnected: "#FF6B6B",
    connecting: "#F7DC6F",
    error: "#FF6B6B",
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Syne:wght@400;700;800&display=swap');
        * { margin:0; padding:0; box-sizing:border-box; }
        html, body, #root { width:100%; height:100%; overflow:hidden; }
        body { background:#0a0a0f; color:#e0e0e0; font-family:'Space Mono',monospace; }

        @keyframes pulse {
          0%,100% { box-shadow:0 0 12px currentColor, 0 0 0 0 rgba(255,255,255,0.3); }
          50%      { box-shadow:0 0 22px currentColor, 0 0 0 9px rgba(255,255,255,0); }
        }
        @keyframes fadeIn { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:none} }

        .app { width:100vw; height:100vh; position:relative; }
        #map { width:100%; height:100%; background:#0d0d12; }

        .panel {
          position:absolute; top:16px; left:16px; z-index:1000;
          background:rgba(8,8,13,0.9); backdrop-filter:blur(18px);
          border:1px solid rgba(255,255,255,0.07); border-radius:16px;
          padding:18px; width:272px; max-height:calc(100vh - 32px);
          overflow-y:auto; animation:fadeIn 0.4s ease;
        }

        @media (max-width: 600px) {
  .panel {
    top: auto;
    left: 0;
    bottom: 0;
    width: 100%;
    max-height: 180px;
    border-radius: 16px 16px 0 0;
    padding: 12px;
    overflow-y: scroll;
  }
  .toggle-btn {
    display: none; /* opcional */
  }
}
        .panel::-webkit-scrollbar { width:3px; }
        .panel::-webkit-scrollbar-thumb { background:rgba(255,255,255,0.1); border-radius:10px; }

        .title {
          font-family:'Syne',sans-serif; font-size:21px; font-weight:800;
          letter-spacing:-0.5px; margin-bottom:2px;
          background:linear-gradient(135deg,#4ECDC4,#45B7D1);
          -webkit-background-clip:text; -webkit-text-fill-color:transparent;
        }
        .subtitle    { font-size:9px; opacity:0.35; letter-spacing:2.5px; text-transform:uppercase; margin-bottom:14px; }
        .status-row  { display:flex; align-items:center; gap:8px; }
        .dot         { width:8px; height:8px; border-radius:50%; flex-shrink:0; }
        .status-text { font-size:10px; opacity:0.6; text-transform:uppercase; letter-spacing:1px; }
        .divider     { height:1px; background:rgba(255,255,255,0.06); margin:12px 0; }
        .section-label { font-size:8px; letter-spacing:2px; opacity:0.3; text-transform:uppercase; margin-bottom:7px; }

        .coord-box   {
          background:rgba(255,255,255,0.03); border-radius:9px;
          padding:10px 12px; border:1px solid rgba(255,255,255,0.05); margin-bottom:7px;
        }
        .coord-label { font-size:8px; letter-spacing:1.5px; opacity:0.35; text-transform:uppercase; margin-bottom:3px; }
        .coord-value { font-size:13px; color:#4ECDC4; }

        .error-box {
          background:rgba(255,107,107,0.07); border:1px solid rgba(255,107,107,0.25);
          border-radius:10px; padding:12px; font-size:10px; line-height:1.6;
          color:rgba(255,160,160,0.85);
        }
        .error-box b { display:block; margin-bottom:4px; font-size:11px; color:#FF6B6B; text-transform:uppercase; letter-spacing:1px; }
        .waiting     { font-size:10px; opacity:0.35; padding:10px 0; text-align:center; }

        .counter {
          display:inline-flex; align-items:center; gap:6px;
          background:rgba(78,205,196,0.08); color:#4ECDC4;
          padding:3px 10px; border-radius:20px; font-size:10px;
          border:1px solid rgba(78,205,196,0.2); margin-bottom:8px;
        }
        .online-dot { width:6px; height:6px; border-radius:50%; background:#4ECDC4; }

        .users-list { max-height:200px; overflow-y:auto; }
        .users-list::-webkit-scrollbar { width:3px; }
        .users-list::-webkit-scrollbar-thumb { background:rgba(255,255,255,0.08); border-radius:10px; }

        .user-item {
          display:flex; align-items:center; gap:9px; padding:8px 6px;
          border-radius:8px; margin-bottom:3px;
          background:rgba(255,255,255,0.02); cursor:pointer;
          transition:background 0.15s; animation:fadeIn 0.25s ease;
        }
        .user-item:hover { background:rgba(255,255,255,0.05); }
        .user-dot    { width:10px; height:10px; border-radius:50%; flex-shrink:0; }
        .user-info   { flex:1; min-width:0; }
        .me-badge {
          display:inline-block; font-size:7px; background:rgba(78,205,196,0.12);
          color:#4ECDC4; padding:1px 5px; border-radius:4px;
          border:1px solid rgba(78,205,196,0.25); letter-spacing:1px; margin-bottom:2px;
        }
        .user-coords { font-size:10px; opacity:0.75; }
        .user-uid    { font-size:9px; opacity:0.25; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .no-users    { font-size:10px; opacity:0.3; padding:8px 0; text-align:center; }
      `}</style>

      <div className="app">
        <div id="map" ref={mapRef} />

        <div className="panel">
          <div className="title">LiveMap</div>
          <div className="subtitle">Real-time location sharing</div>

          <div className="status-row">
            <div
              className="dot"
              style={{ background: wsColor[wsStatus] || "#888" }}
            />
            <span className="status-text">{wsStatus}</span>
          </div>

          <div className="divider" />

          {geoError ? (
            <div className="error-box">
              <b>📍 Location error</b>
              {geoError}
            </div>
          ) : myCoords ? (
            <>
              <div className="section-label">Your position</div>
              <div className="coord-box">
                <div className="coord-label">Latitude</div>
                <div className="coord-value">{myCoords.lat.toFixed(6)}</div>
              </div>
              <div className="coord-box">
                <div className="coord-label">Longitude</div>
                <div className="coord-value">{myCoords.lng.toFixed(6)}</div>
              </div>
            </>
          ) : (
            <div className="waiting">⏳ Waiting for location permission...</div>
          )}

          <div className="divider" />

          <div className="counter">
            <span className="online-dot" />
            {users.filter((u) => u.lat != null).length} online
          </div>
          <div className="section-label">Connected users</div>
          <div className="users-list">
            {users.filter((u) => u.lat != null).length === 0 ? (
              <div className="no-users">No users with location yet</div>
            ) : (
              users
                .filter((u) => u.lat != null)
                .map((user) => {
                  const isMe = user.id === myId;
                  return (
                    <div
                      key={user.id}
                      className="user-item"
                      title="Click to zoom to this user"
                      onClick={() =>
                        leafletMapRef.current?.flyTo([user.lat, user.lng], 14)
                      }
                    >
                      <div
                        className="user-dot"
                        style={{
                          background: idToColor(user.id),
                          boxShadow: `0 0 6px ${idToColor(user.id)}`,
                        }}
                      />
                      <div className="user-info">
                        {isMe && <span className="me-badge">YOU</span>}
                        <div className="user-coords">
                          {user.lat.toFixed(5)}, {user.lng.toFixed(5)}
                        </div>
                        <div className="user-uid">{user.id}</div>
                      </div>
                    </div>
                  );
                })
            )}
          </div>
        </div>
      </div>
    </>
  );
}
