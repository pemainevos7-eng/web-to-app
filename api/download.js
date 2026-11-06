
const OWNER = "pemainevos7-eng";
const REPO = "web-to-app";
const API = "https://api.github.com";

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Gunakan GET." });
  }

  const token = process.env.GITHUB_TOKEN;

  if (!token) {
    return res.status(500).json({
      error: "GITHUB_TOKEN belum dipasang."
    });
  }

  const requestId = req.query?.requestId;

  if (!requestId || !/^[a-f0-9-]{36}$/i.test(requestId)) {
    return res.status(400).json({
      error: "Request ID tidak valid."
    });
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28"
  };

  try {
    const runsResponse = await fetch(
      `${API}/repos/${OWNER}/${REPO}/actions/workflows/build.yml/runs?per_page=50`,
      { headers }
    );

    if (!runsResponse.ok) {
      throw new Error("Gagal membaca data GitHub Actions.");
    }

    const runsData = await runsResponse.json();

    const run = (runsData.workflow_runs || []).find(
      item => item.display_title === `ZORA BUILD - ${requestId}`
    );

    if (!run || run.status !== "completed" || run.conclusion !== "success") {
      return res.status(409).json({
        error: "APK belum selesai dibuat."
      });
    }

    const artifactResponse = await fetch(
      `${API}/repos/${OWNER}/${REPO}/actions/runs/${run.id}/artifacts`,
      { headers }
    );

    if (!artifactResponse.ok) {
      throw new Error("Gagal mencari file APK.");
    }

    const artifactData = await artifactResponse.json();

    const artifact = (artifactData.artifacts || []).find(
      item =>
        item.name === `ZORA-BUILDER-${requestId}` &&
        !item.expired
    );

    if (!artifact) {
      return res.status(404).json({
        error: "Artifact APK tidak ditemukan atau sudah kedaluwarsa."
      });
    }

    const zipResponse = await fetch(
      `${API}/repos/${OWNER}/${REPO}/actions/artifacts/${artifact.id}/zip`,
      { headers }
    );

    if (!zipResponse.ok) {
      throw new Error("Gagal mengunduh artifact dari GitHub.");
    }

    const zipBuffer = Buffer.from(await zipResponse.arrayBuffer());

    // Cari APK di dalam ZIP tanpa mengekstrak file lain.
    let apkBuffer = null;
    let apkName = "ZORA-APP.apk";

    let eocd = -1;

    for (let i = zipBuffer.length - 22; i >= Math.max(0, zipBuffer.length - 65557); i--) {
      if (zipBuffer.readUInt32LE(i) === 0x06054b50) {
        eocd = i;
        break;
      }
    }

    if (eocd < 0) {
      throw new Error("Arsip ZIP tidak valid.");
    }

    const entryCount = zipBuffer.readUInt16LE(eocd + 10);
    let offset = zipBuffer.readUInt32LE(eocd + 16);

    for (let i = 0; i < entryCount; i++) {
      if (zipBuffer.readUInt32LE(offset) !== 0x02014b50) {
        throw new Error("Struktur ZIP tidak valid.");
      }

      const method = zipBuffer.readUInt16LE(offset + 10);
      const compressedSize = zipBuffer.readUInt32LE(offset + 20);
      const nameLength = zipBuffer.readUInt16LE(offset + 28);
      const extraLength = zipBuffer.readUInt16LE(offset + 30);
      const commentLength = zipBuffer.readUInt16LE(offset + 32);
      const localOffset = zipBuffer.readUInt32LE(offset + 42);

      const name = zipBuffer
        .subarray(offset + 46, offset + 46 + nameLength)
        .toString("utf8");

      if (name.toLowerCase().endsWith(".apk")) {
        const localNameLength = zipBuffer.readUInt16LE(localOffset + 26);
        const localExtraLength = zipBuffer.readUInt16LE(localOffset + 28);
        const start = localOffset + 30 + localNameLength + localExtraLength;
        const compressed = zipBuffer.subarray(start, start + compressedSize);

        if (method === 0) {
          apkBuffer = Buffer.from(compressed);
        } else if (method === 8) {
          apkBuffer = require("zlib").inflateRawSync(compressed);
        } else {
          throw new Error("Metode kompresi APK tidak didukung.");
        }

        apkName = name.split("/").pop();
        break;
      }

      offset += 46 + nameLength + extraLength + commentLength;
    }

    if (!apkBuffer) {
      throw new Error("File APK tidak ditemukan dalam artifact.");
    }

    res.setHeader(
      "Content-Type",
      "application/vnd.android.package-archive"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${apkName.replace(/["\\]/g, "_")}"`
    );
    res.setHeader("Content-Length", apkBuffer.length);
    res.setHeader("Cache-Control", "no-store");

    return res.status(200).send(apkBuffer);

  } catch (error) {
    return res.status(500).json({
      error: "Download APK gagal.",
      details: error.message
    });
  }
};
