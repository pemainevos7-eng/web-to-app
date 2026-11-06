
const { inflateRawSync } = require("zlib");

const REPO = "pemainevos7-eng/web-to-app";
const WORKFLOW = "build.yml";

function extractApk(zip) {
  const endSignature = 0x06054b50;
  let end = -1;

  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65558); i--) {
    if (zip.readUInt32LE(i) === endSignature) {
      end = i;
      break;
    }
  }

  if (end < 0) throw new Error("Arsip APK tidak valid.");

  const entries = zip.readUInt16LE(end + 10);
  let offset = zip.readUInt32LE(end + 16);

  for (let i = 0; i < entries; i++) {
    if (zip.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error("Data ZIP tidak valid.");
    }

    const method = zip.readUInt16LE(offset + 10);
    const compressedSize = zip.readUInt32LE(offset + 20);
    const uncompressedSize = zip.readUInt32LE(offset + 24);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const localOffset = zip.readUInt32LE(offset + 42);

    const name = zip
      .subarray(offset + 46, offset + 46 + nameLength)
      .toString("utf8");

    if (name.toLowerCase().endsWith(".apk")) {
      if (uncompressedSize > 100 * 1024 * 1024) {
        throw new Error("Ukuran APK terlalu besar.");
      }

      if (zip.readUInt32LE(localOffset) !== 0x04034b50) {
        throw new Error("File APK tidak valid.");
      }

      const localNameLength = zip.readUInt16LE(localOffset + 26);
      const localExtraLength = zip.readUInt16LE(localOffset + 28);

      const dataOffset =
        localOffset + 30 + localNameLength + localExtraLength;

      const compressed = zip.subarray(
        dataOffset,
        dataOffset + compressedSize
      );

      let apk;

      if (method === 0) {
        apk = Buffer.from(compressed);
      } else if (method === 8) {
        apk = inflateRawSync(compressed);
      } else {
        throw new Error("Format kompresi APK tidak didukung.");
      }

      if (apk.length !== uncompressedSize) {
        throw new Error("Ukuran APK tidak sesuai.");
      }

      return apk;
    }

    offset += 46 + nameLength + extraLength + commentLength;
  }

  throw new Error("File APK tidak ditemukan di artifact.");
}

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    return res.status(405).json({
      success: false,
      message: "Method tidak diizinkan."
    });
  }

  try {
    const token = process.env.GITHUB_TOKEN;
    const requestId = String(req.query.requestId || "");

    if (!token) {
      return res.status(500).json({
        success: false,
        message: "Server belum dikonfigurasi."
      });
    }

    if (!/^[a-f0-9-]{36}$/i.test(requestId)) {
      return res.status(400).json({
        success: false,
        message: "ID build tidak valid."
      });
    }

    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    };

    const runsResponse = await fetch(
      `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/runs?event=workflow_dispatch&branch=main&per_page=50`,
      { headers }
    );

    if (!runsResponse.ok) {
      throw new Error("Tidak bisa membaca daftar build.");
    }

    const runsData = await runsResponse.json();

    const run = (runsData.workflow_runs || []).find(item =>
      item.display_title === `ZORA BUILD - ${requestId}`
    );

    if (!run) {
      return res.status(404).json({
        success: false,
        message: "Build tidak ditemukan."
      });
    }

    if (run.status !== "completed" || run.conclusion !== "success") {
      return res.status(409).json({
        success: false,
        message: "APK belum selesai dibuat."
      });
    }

    const artifactsResponse = await fetch(
      `https://api.github.com/repos/${REPO}/actions/runs/${run.id}/artifacts`,
      { headers }
    );

    if (!artifactsResponse.ok) {
      throw new Error("Tidak bisa mengambil daftar artifact.");
    }

    const artifactsData = await artifactsResponse.json();

    const artifact = (artifactsData.artifacts || []).find(item =>
      item.name === `ZORA-BUILDER-${requestId}` &&
      !item.expired
    );

    if (!artifact) {
      return res.status(404).json({
        success: false,
        message: "File APK tidak ditemukan atau sudah kedaluwarsa."
      });
    }

    const zipResponse = await fetch(
      `https://api.github.com/repos/${REPO}/actions/artifacts/${artifact.id}/zip`,
      { headers }
    );

    if (!zipResponse.ok) {
      throw new Error("Gagal mengunduh artifact dari GitHub.");
    }

    const zip = Buffer.from(await zipResponse.arrayBuffer());
    const apk = extractApk(zip);

    res.setHeader(
      "Content-Type",
      "application/vnd.android.package-archive"
    );

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="ZORA-${requestId}.apk"`
    );

    res.setHeader("Content-Length", apk.length);
    res.setHeader("Cache-Control", "no-store");

    return res.status(200).send(apk);

  } catch (error) {
    console.error("DOWNLOAD ERROR:", error);

    return res.status(500).json({
      success: false,
      message: error.message || "Gagal mengunduh APK."
    });
  }
};
