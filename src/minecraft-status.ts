import { createConnection } from "node:net";

function varInt(value: number) {
  const bytes: number[] = [];
  let remaining = value >>> 0;
  do {
    const byte = remaining & 0x7f;
    remaining >>>= 7;
    bytes.push(remaining ? byte | 0x80 : byte);
  } while (remaining);
  return Buffer.from(bytes);
}

function readVarInt(buffer: Buffer, offset = 0) {
  let value = 0;
  for (let index = 0; index < 5 && offset + index < buffer.length; index++) {
    const byte = buffer[offset + index];
    value |= (byte & 0x7f) << (7 * index);
    if (!(byte & 0x80)) {
      return { value: value >>> 0, bytes: index + 1 };
    }
  }
  return undefined;
}

export function isMinecraftReady(host: string, port = 25565, timeoutMs = 2000) {
  return new Promise<boolean>((resolve) => {
    const socket = createConnection({ host, port });
    let received = Buffer.alloc(0);
    let settled = false;
    const finish = (ready: boolean, reason?: string) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(deadline);
      socket.destroy();
      if (reason) {
        console.warn("Minecraft status probe:", reason);
      }
      resolve(ready);
    };
    const deadline = setTimeout(() => finish(false, "timeout"), timeoutMs);
    socket.on("connect", () => {
      const address = Buffer.from(host);
      const portBytes = Buffer.alloc(2);
      portBytes.writeUInt16BE(port);
      const handshake = Buffer.concat([
        varInt(0),
        varInt(-1),
        varInt(address.length),
        address,
        portBytes,
        varInt(1),
      ]);
      socket.write(
        Buffer.concat([
          varInt(handshake.length),
          handshake,
          Buffer.from([1, 0]),
        ]),
      );
    });
    socket.on("error", (error: NodeJS.ErrnoException) => {
      finish(false, error.code ?? "connection error");
    });
    socket.on("end", () => finish(false, "connection closed before status"));
    socket.on("data", (chunk: Buffer) => {
      if (settled) {
        return;
      }
      received = Buffer.concat([received, chunk]);
      if (received.length > 1024 * 1024) {
        finish(false, "status response too large");
        return;
      }
      const packet = readVarInt(received);
      if (!packet) {
        return;
      }
      if (packet.value > 1024 * 1024 || packet.value < 2) {
        finish(false, "invalid status packet length");
        return;
      }
      if (received.length < packet.bytes + packet.value) {
        return;
      }
      const body = received.subarray(packet.bytes, packet.bytes + packet.value);
      const id = readVarInt(body);
      const length = id && readVarInt(body, id.bytes);
      if (
        id?.value !== 0 ||
        !length ||
        id.bytes + length.bytes + length.value !== body.length
      ) {
        finish(false, "invalid status packet");
        return;
      }
      let status: unknown;
      try {
        status = JSON.parse(
          body.subarray(id.bytes + length.bytes).toString("utf8"),
        );
      } catch {
        finish(false, "invalid status JSON");
        return;
      }
      const ready =
        typeof status === "object" &&
        status !== null &&
        "version" in status &&
        typeof status.version === "object" &&
        status.version !== null &&
        "protocol" in status.version &&
        typeof status.version.protocol === "number" &&
        "players" in status &&
        typeof status.players === "object" &&
        status.players !== null &&
        "online" in status.players &&
        typeof status.players.online === "number";
      finish(ready, ready ? undefined : "invalid Minecraft status");
    });
  });
}
