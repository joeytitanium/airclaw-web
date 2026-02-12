"use client";

import { signOut } from "next-auth/react";
import { useCallback, useEffect, useRef, useState } from "react";

interface Message {
  id?: string;
  role: "user" | "assistant";
  content: string;
  createdAt?: string;
}

interface WSResponse {
  type: "message" | "pong" | "status" | "error";
  content?: string;
  messageId?: string;
  status?: string;
  error?: string;
  errorCode?: string;
}

export default function DevChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [machineStatus, setMachineStatus] = useState("stopped");
  const [credits, setCredits] = useState<number | null>(null);
  const [userEmail, setUserEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [machineLoading, setMachineLoading] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(scrollToBottom, [messages]);

  // Fetch user info
  useEffect(() => {
    fetch("/api/user")
      .then((r) => r.json())
      .then((d) => {
        if (d.success) setUserEmail(d.data.email);
      });
  }, []);

  // Fetch credits
  const refreshCredits = useCallback(() => {
    fetch("/api/credits")
      .then((r) => r.json())
      .then((d) => {
        if (d.success) setCredits(d.data.balance);
      });
  }, []);

  useEffect(() => {
    refreshCredits();
  }, [refreshCredits]);

  // Fetch message history
  useEffect(() => {
    fetch("/api/messages")
      .then((r) => r.json())
      .then((d) => {
        if (d.success) setMessages(d.data.messages);
      });
  }, []);

  // Fetch machine status
  const refreshMachineStatus = useCallback(() => {
    fetch("/api/machine/status")
      .then((r) => r.json())
      .then((d) => {
        if (d.success) setMachineStatus(d.data.status);
      });
  }, []);

  useEffect(() => {
    refreshMachineStatus();
  }, [refreshMachineStatus]);

  // WebSocket connection with auto-reconnect
  useEffect(() => {
    let ws: WebSocket | null = null;
    let pingInterval: ReturnType<typeof setInterval> | null = null;
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    function connect() {
      if (closed) return;
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log("[ws] connected");
        setWsConnected(true);
      };

      ws.onclose = (e) => {
        console.log("[ws] closed", e.code, e.reason);
        setWsConnected(false);
        wsRef.current = null;
        if (!closed) {
          reconnectTimeout = setTimeout(connect, 2000);
        }
      };

      ws.onerror = () => {
        console.log("[ws] error");
        setWsConnected(false);
      };

      ws.onmessage = (event) => {
        const data: WSResponse = JSON.parse(event.data);

        switch (data.type) {
          case "status":
            if (data.status) setMachineStatus(data.status);
            break;
          case "message":
            setMessages((prev) => [
              ...prev,
              {
                id: data.messageId,
                role: "assistant",
                content: data.content || "",
              },
            ]);
            setSending(false);
            refreshCredits();
            break;
          case "error":
            setMessages((prev) => [
              ...prev,
              {
                role: "assistant",
                content: `Error: ${data.error}${data.errorCode ? ` (${data.errorCode})` : ""}`,
              },
            ]);
            setSending(false);
            break;
          case "pong":
            break;
        }
      };
    }

    connect();

    // Heartbeat
    pingInterval = setInterval(() => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "ping" }));
      }
    }, 30000);

    return () => {
      closed = true;
      if (pingInterval) clearInterval(pingInterval);
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      ws?.close();
    };
  }, [refreshCredits]);

  async function handleStartMachine() {
    setMachineLoading(true);
    try {
      const res = await fetch("/api/machine/start", { method: "POST" });
      const d = await res.json();
      if (d.success) {
        setMachineStatus(d.data.status);
      } else {
        console.error("[machine/start] error:", d);
        alert(
          `Failed to start machine: ${d.publicFacingMessage || d.error || "Unknown error"}`,
        );
      }
    } catch (err) {
      console.error("[machine/start] fetch error:", err);
      alert(`Failed to start machine: ${err}`);
    } finally {
      setMachineLoading(false);
    }
  }

  async function handleStopMachine() {
    setMachineLoading(true);
    try {
      const res = await fetch("/api/machine/stop", { method: "POST" });
      const d = await res.json();
      if (d.success) setMachineStatus("stopped");
    } finally {
      setMachineLoading(false);
    }
  }

  function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (
      !input.trim() ||
      !wsRef.current ||
      wsRef.current.readyState !== WebSocket.OPEN
    )
      return;

    const content = input.trim();
    setMessages((prev) => [...prev, { role: "user", content }]);
    wsRef.current.send(JSON.stringify({ type: "message", content }));
    setInput("");
    setSending(true);
  }

  const statusColor: Record<string, string> = {
    stopped: "#999",
    starting: "#f59e0b",
    running: "#22c55e",
    stopping: "#f59e0b",
    error: "#ef4444",
  };

  return (
    <div
      style={{
        fontFamily: "system-ui",
        height: "100vh",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "0.75rem 1rem",
          borderBottom: "1px solid #e5e5e5",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
          <strong>OpenClaw Dev</strong>
          <span style={{ color: "#666", fontSize: "0.875rem" }}>
            {userEmail}
          </span>
          <span style={{ fontSize: "0.875rem" }}>
            Credits: {credits ?? "..."}
          </span>
        </div>
        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
          <span
            style={{
              fontSize: "0.75rem",
              color: wsConnected ? "#22c55e" : "#ef4444",
            }}
          >
            WS: {wsConnected ? "connected" : "disconnected"}
          </span>
          <button
            type="button"
            onClick={async () => {
              await fetch("/api/messages", { method: "DELETE" });
              setMessages([]);
            }}
            style={{ fontSize: "0.875rem", cursor: "pointer" }}
          >
            Clear
          </button>
          <button
            type="button"
            onClick={() => signOut({ callbackUrl: "/dev" })}
            style={{ fontSize: "0.875rem", cursor: "pointer" }}
          >
            Logout
          </button>
        </div>
      </div>

      {/* Machine Controls */}
      <div
        style={{
          padding: "0.5rem 1rem",
          borderBottom: "1px solid #e5e5e5",
          display: "flex",
          gap: "0.75rem",
          alignItems: "center",
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: "0.875rem" }}>
          Machine:{" "}
          <span
            style={{
              color: statusColor[machineStatus] || "#999",
              fontWeight: 600,
            }}
          >
            {machineStatus}
          </span>
        </span>
        {machineStatus === "stopped" && (
          <button
            onClick={handleStartMachine}
            disabled={machineLoading}
            style={{ fontSize: "0.875rem", cursor: "pointer" }}
          >
            {machineLoading ? "Starting..." : "Start"}
          </button>
        )}
        {machineStatus === "running" && (
          <button
            onClick={handleStopMachine}
            disabled={machineLoading}
            style={{ fontSize: "0.875rem", cursor: "pointer" }}
          >
            {machineLoading ? "Stopping..." : "Stop"}
          </button>
        )}
        <button
          onClick={refreshMachineStatus}
          style={{ fontSize: "0.875rem", cursor: "pointer" }}
        >
          Refresh
        </button>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflow: "auto", padding: "1rem" }}>
        {messages.length === 0 && (
          <p style={{ color: "#999", textAlign: "center", marginTop: "2rem" }}>
            No messages yet. Start the machine and send a message.
          </p>
        )}
        {messages.map((msg, i) => (
          <div
            key={msg.id || i}
            style={{
              marginBottom: "0.75rem",
              padding: "0.5rem 0.75rem",
              borderRadius: 8,
              background: msg.role === "user" ? "#f0f0f0" : "#e8f4ff",
              maxWidth: "80%",
              marginLeft: msg.role === "user" ? "auto" : 0,
              marginRight: msg.role === "user" ? 0 : "auto",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            <div
              style={{
                fontSize: "0.75rem",
                color: "#666",
                marginBottom: "0.25rem",
              }}
            >
              {msg.role === "user" ? "You" : "Assistant"}
            </div>
            {msg.content}
          </div>
        ))}
        {sending && (
          <div
            style={{ color: "#999", fontSize: "0.875rem", padding: "0.5rem" }}
          >
            Thinking...
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form
        onSubmit={handleSend}
        style={{
          padding: "0.75rem 1rem",
          borderTop: "1px solid #e5e5e5",
          display: "flex",
          gap: "0.5rem",
          flexShrink: 0,
        }}
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message..."
          disabled={sending}
          style={{
            flex: 1,
            padding: "0.5rem",
            fontSize: "1rem",
            border: "1px solid #ccc",
            borderRadius: 4,
          }}
        />
        <button
          type="submit"
          disabled={sending || !input.trim()}
          style={{
            padding: "0.5rem 1rem",
            fontSize: "1rem",
            background: "#000",
            color: "#fff",
            border: "none",
            borderRadius: 4,
            cursor: sending ? "wait" : "pointer",
          }}
        >
          Send
        </button>
      </form>
    </div>
  );
}
