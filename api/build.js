
const crypto = require("crypto");

const OWNER = "pemainevos7-eng";
const REPO = "web-to-app";
const WORKFLOW = "build.yml";
const API = "https://api.github.com";
const MAX_FILE_SIZE = 2 * 1024 * 1024;

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Gunakan POST." });
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    return res.status(500).json({
      success: false,
      error: "GITHUB_TOKEN belum dipasang di Vercel."
    });
  }

  const gh = async (url, options = {}) => fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.headers || {})
    }
  });

  try {
    const body = typeof req.body === "string"
      ? JSON.parse(req.body)
      : req.body || {};

    const {
      appName,
      packageName,
      websiteUrl = "",
      sourceType = "url",
      sourceBase64 = "",
      iconBase64 = "",
      splashBase64 = "",
      orientation = "portrait",
      versionName = "1.0.0",
      themeColor = "#202020",
      splashDuration = 2000
    } = body;

    if (!appName || !packageName) {
      return res.status(400).json({
        success: false,
        error: "Nama aplikasi dan package name wajib diisi."
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
        error: "Package name tidak valid."
      });
    }

    if (!["url", "html", "zip"].includes(sourceType)) {
      return res.status(400).json({
        success: false,
        error: "Mode sumber tidak valid."
      });
    }

    let parsedUrl = null;

    if (sourceType === "url") {
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
          error: "URL harus HTTP atau HTTPS."
        });
      }
    } else {
      if (typeof sourceBase64 !== "string" || !sourceBase64) {
        return res.status(400).json({
          success: false,
          error: "File HTML atau ZIP belum dipilih."
        });
      }

      const raw = sourceBase64.replace(/^data:[^,]+,/, "");

      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(raw)) {
        return res.status(400).json({
          success: false,
          error: "Data file tidak valid."
        });
      }

      const fileBuffer = Buffer.from(raw, "base64");

      if (
        fileBuffer.length === 0 ||
        fileBuffer.length > MAX_FILE_SIZE ||
        fileBuffer.toString("base64").replace(/=+$/, "") !== raw.replace(/=+$/, "")
      ) {
        return res.status(413).json({
          success: false,
          error: "File kosong, tidak valid, atau melebihi 2 MB."
        });
      }

      const requestId = crypto.randomUUID();
      const fileName = sourceType === "html" ? "index.html" : "site.zip";
      const sourcePath = `sources/${requestId}/${fileName}`;

      if (sourceType === "html") {
        const html = fileBuffer.toString("utf8");
        if (!/<html[\s>]/i.test(html) && !/<!doctype\s+html/i.test(html)) {
          return res.status(400).json({
            success: false,
            error: "File harus berupa dokumen HTML."
          });
        }
      }

      const upload = await gh(
        `${API}/repos/${OWNER}/${REPO}/contents/${sourcePath}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: `ZORA source upload ${requestId}`,
            content: fileBuffer.toString("base64"),
            branch: "main"
          })
        }
      );

      if (!upload.ok) {
        const details = await upload.text();
        return res.status(502).json({
          success: false,
          error: "Gagal mengunggah file sumber ke GitHub.",
          details: details.slice(0, 1000)
        });
      }

      return await dispatchBuild({
        requestId,
        sourceType,
        sourcePath,
        appName,
        packageName,
        websiteUrl: "",
        iconBase64,
        splashBase64,
        orientation,
        versionName,
        themeColor,
        splashDuration,
        res,
        gh
      });
    }

    const requestId = crypto.randomUUID();

    return await dispatchBuild({
      requestId,
      sourceType: "url",
      sourcePath: "",
      appName,
      packageName,
      websiteUrl: parsedUrl.href,
      iconBase64,
      splashBase64,
      orientation,
      versionName,
      themeColor,
      splashDuration,
      res,
      gh
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      error: "Terjadi kesalahan pada server.",
      details: error.message
    });
  }
};

async function dispatchBuild(data) {
  const {
    requestId,
    sourceType,
    sourcePath,
    appName,
    packageName,
    websiteUrl,
    iconBase64,
    splashBase64,
    orientation,
    versionName,
    themeColor,
    splashDuration,
    res,
    gh
  } = data;

  if ((iconBase64 || "").length > 25000 ||
      (splashBase64 || "").length > 25000) {
    return res.status(413).json({
      success: false,
      error: "Ukuran gambar terlalu besar."
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
      error: "Warna tema tidak valid."
    });
  }

  if (!/^[0-9]+(\.[0-9]+){1,2}$/.test(versionName)) {
    return res.status(400).json({
      success: false,
      error: "Format versi tidak valid."
    });
  }

  const duration = Number(splashDuration);
  if (!Number.isFinite(duration) || duration < 0 || duration > 10000) {
    return res.status(400).json({
      success: false,
      error: "Durasi splash tidak valid."
    });
  }

  const response = await gh(
    `${API}/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW}/dispatches`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ref: "main",
        inputs: {
          request_id: requestId,
          app_name: appName,
          package_name: packageName,
          website_url: websiteUrl,
          source_type: sourceType,
          source_path: sourcePath,
          icon_base64: iconBase64 || "",
          splash_base64: splashBase64 || "",
          orientation,
          version_name: versionName,
          theme_color: themeColor,
          splash_duration: String(Math.floor(duration))
        }
      })
    }
  );

  if (response.status !== 204) {
    const details = await response.text();
    return res.status(502).json({
      success: false,
      error: "GitHub gagal menerima permintaan build.",
      details: details.slice(0, 1500)
    });
  }

  return res.status(200).json({
    success: true,
    message: "Build berhasil dikirim.",
    requestId,
    status: "queued"
  });
}
