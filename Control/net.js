/**
 * WebSocket client for online rooms.
 */
const Net = (() => {
  function connect(handlers = {}) {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${location.host}`);
    let open = false;
    const queue = [];

    function send(payload) {
      const data = JSON.stringify(payload);
      if (open && ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      } else {
        queue.push(data);
      }
    }

    ws.addEventListener("open", () => {
      open = true;
      while (queue.length) ws.send(queue.shift());
      if (handlers.onOpen) handlers.onOpen();
    });

    ws.addEventListener("message", (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (handlers.onMessage) handlers.onMessage(msg);
    });

    ws.addEventListener("close", () => {
      open = false;
      if (handlers.onClose) handlers.onClose();
    });

    ws.addEventListener("error", () => {
      if (handlers.onError) handlers.onError();
    });

    return {
      send,
      create() {
        send({ type: "create" });
      },
      join(code) {
        send({ type: "join", code });
      },
      place(r, c) {
        send({ type: "place", r, c });
      },
      reset() {
        send({ type: "reset" });
      },
      leave() {
        send({ type: "leave" });
      },
      close() {
        ws.close();
      },
    };
  }

  return { connect };
})();
