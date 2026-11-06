
const crypto = require("crypto");

const OWNER = "pemainevos7-eng";
const REPO = "web-to-app";
const WORKFLOW = "build.yml";
const API = "https://api.github.com";

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Gunakan metode POST."
    });
  }

  const token = process.env.GITHUB_TOKEN;

  if (!token) {
    return res.status(500).json({
      success: false,
      error: "GITHUB_TOKEN belum dipasang di Vercel."
    });
  }

  try {
    const body = typeof req.body === "string"
      ? JSON.parse(req.body)
      : req.body || {};

    const {
      appName,
      packageName,
      websiteUrl,
      iconBase64 = "",
      splashBase64 = "",
      orientation = "portrait",
      versionName = "1.0.0",
      themeColor = "#202020",
      splashDuration = 2000
    } = body;

    if (!appName || !packageName || !websiteUrl) {
      return res.status(400).json({
        success: false,
        error: "Nama aplikasi, package name, dan URL wajib diisi."
      });
    }

    if (appName.length > 50) {
      return res.status(400).json({
        success: false,
        error: "Nama aplikasi maksimal 50 karakter."
      });
    }

    if (!/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/.test(packageName)) {
      return res.status(400).json({
        success: false,
        error: "Format package name tidak valid."
      });
    }

    let parsedUrl;

    try {
      parsedUrl = new URL(websiteUrl);
    } catch {
      return res.status(400).json({
        success: false,
        error: "URL website tidak valid."
      });
    }

    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      return res.status(400).json({
        success: false,
        error: "URL harus menggunakan HTTP atau HTTPS."
      });
    }

    if (!["portrait", "landscape"].includes(orientation)) {
      return res.status(400).json({
        success: false,
        error: "Orientasi tidak valid."
      });
    }

    if (!/^#[0-9a-fA-F]{6}$/.test(themeColor)) {
      return res.status(400).json({
        success: false,
        error: "Warna tema harus menggunakan format HEX."
      });
    }

    if (!/^[0-9]+(\.[0-9]+){1,2}$/.test(versionName)) {
      return res.status(400).json({
        success: false,
        error: "Format versi tidak valid. Contoh: 1.0.0"
      });
    }

    if (iconBase64.length > 25000 || splashBase64.length > 25000) {
      return res.status(413).json({
        success: false,
        error: "Ukuran gambar terlalu besar. Gunakan gambar yang lebih kecil."
      });
    }

    const duration = Number(splashDuration);

    if (!Number.isFinite(duration) || duration < 0 || duration > 10000) {
      return res.status(400).json({
        success: false,
        error: "Durasi splash harus antara 0 sampai 10000 ms."
      });
    }

    const requestId = crypto.randomUUID();

    const inputs = {
      request_id: requestId,
      app_name: appName,
      package_name: packageName,
      website_url: parsedUrl.href,
      icon_base64: iconBase64,
      splash_base64: splashBase64,
      orientation,
      version_name: versionName,
      theme_color: themeColor,
      splash_duration: String(Math.floor(duration))
    };

    const response = await fetch(
      `${API}/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW}/dispatches`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          ref: "main",
          inputs
        })
      }
    );

    if (response.status !== 204) {
      const details = await response.text();

      return res.status(response.status).json({
        success: false,
        error: "GitHub gagal menerima permintaan build.",
        details: details.slice(0, 1500)
      });
    }

    return res.status(200).json({
      success: true,
      message: "Permintaan build berhasil dikirim.",
      requestId,
      status: "queued"
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      error: "Terjadi kesalahan pada server.",
      details: error.message
    });
  }
};
