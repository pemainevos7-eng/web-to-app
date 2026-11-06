
const crypto = require("crypto");

const REPO = "pemainevos7-eng/web-to-app";
const WORKFLOW = "build.yml";

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      message: "Method tidak diizinkan."
    });
  }

  try {
    const token = process.env.GITHUB_TOKEN;

    if (!token) {
      return res.status(500).json({
        success: false,
        message: "GITHUB_TOKEN belum dikonfigurasi."
      });
    }

    const {
      appName,
      packageName,
      websiteUrl,
      iconBase64 = "",
      splashBase64 = "",
      orientation = "portrait",
      versionName = "1.0.0",
      themeColor = "#101114",
      splashDuration = 2000
    } = req.body || {};

    if (!appName || !packageName || !websiteUrl) {
      return res.status(400).json({
        success: false,
        message: "Lengkapi nama, package, dan URL website."
      });
    }

    const name = String(appName).trim();
    const pkg = String(packageName).trim();

    if (!name || name.length > 40) {
      return res.status(400).json({
        success: false,
        message: "Nama aplikasi maksimal 40 karakter."
      });
    }

    if (!/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/.test(pkg)) {
      return res.status(400).json({
        success: false,
        message: "Package name tidak valid."
      });
    }

    let url;

    try {
      url = new URL(websiteUrl);
    } catch {
      return res.status(400).json({
        success: false,
        message: "URL website tidak valid."
      });
    }

    if (!["https:", "http:"].includes(url.protocol)) {
      return res.status(400).json({
        success: false,
        message: "URL harus HTTP atau HTTPS."
      });
    }

    if (!["portrait", "landscape"].includes(orientation)) {
      return res.status(400).json({
        success: false,
        message: "Orientasi tidak valid."
      });
    }

    if (!/^[A-Za-z0-9._-]{1,20}$/.test(versionName)) {
      return res.status(400).json({
        success: false,
        message: "Versi aplikasi tidak valid."
      });
    }

    if (!/^#[0-9a-fA-F]{6}$/.test(themeColor)) {
      return res.status(400).json({
        success: false,
        message: "Warna tema tidak valid."
      });
    }

    const duration = Number(splashDuration);

    if (!Number.isInteger(duration) || duration < 0 || duration > 10000) {
      return res.status(400).json({
        success: false,
        message: "Durasi loading screen tidak valid."
      });
    }

    // Batasi ukuran gambar agar request tidak terlalu besar.
    if (
      typeof iconBase64 !== "string" ||
      typeof splashBase64 !== "string" ||
      iconBase64.length > 25000 ||
      splashBase64.length > 25000
    ) {
      return res.status(400).json({
        success: false,
        message: "Ukuran gambar terlalu besar."
      });
    }

    const requestId = crypto.randomUUID();

    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      "User-Agent": "ZORA-BUILDER"
    };

    const dispatchUrl =
      `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`;

    const dispatch = await fetch(dispatchUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        ref: "main",
        inputs: {
          request_id: requestId,
          app_name: name,
          package_name: pkg,
          website_url: url.href,
          icon_base64: iconBase64,
          splash_base64: splashBase64,
          orientation,
          version_name: versionName,
          theme_color: themeColor,
          splash_duration: String(duration)
        }
      })
    });

    if (dispatch.status !== 204) {
      const detail = await dispatch.text();

      console.error("GitHub dispatch error:", {
        status: dispatch.status,
        detail
      });

      return res.status(502).json({
        success: false,
        message: "GitHub gagal menerima build.",
        githubStatus: dispatch.status,
        detail: detail.slice(0, 1000)
      });
    }

    // Cari workflow run berdasarkan ID unik.
    const runsUrl =
      `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/runs?event=workflow_dispatch&branch=main&per_page=20`;

    let run = null;

    for (let attempt = 0; attempt < 15; attempt++) {
      const result = await fetch(runsUrl, { headers });

      if (!result.ok) {
        break;
      }

      const data = await result.json();

      run = (data.workflow_runs || []).find(item =>
        item.display_title === `ZORA BUILD - ${requestId}`
      );

      if (run) break;

      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    if (!run) {
      return res.status(202).json({
        success: true,
        message: "Build terkirim. ID proses belum tersedia.",
        requestId,
        actionsUrl: `https://github.com/${REPO}/actions`
      });
    }

    return res.status(200).json({
      success: true,
      message: "Build berhasil dimulai.",
      requestId,
      runId: run.id,
      status: run.status,
      actionsUrl: run.html_url
    });

  } catch (error) {
    console.error("ZORA BUILD ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Terjadi kesalahan pada server.",
      detail: error.message
    });
  }
};
