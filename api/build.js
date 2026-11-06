
module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      message: "Method tidak diizinkan."
    });
  }

  try {
    const { appName, packageName, websiteUrl } = req.body || {};

    // Validasi input
    if (!appName || !packageName || !websiteUrl) {
      return res.status(400).json({
        success: false,
        message: "Nama aplikasi, package name, dan URL wajib diisi."
      });
    }

    const cleanName = String(appName).trim().slice(0, 40);
    const cleanPackage = String(packageName).trim();
    const cleanUrl = String(websiteUrl).trim();

    if (!cleanName) {
      return res.status(400).json({
        success: false,
        message: "Nama aplikasi tidak boleh kosong."
      });
    }

    const validPackage =
      /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/.test(cleanPackage);

    if (!validPackage) {
      return res.status(400).json({
        success: false,
        message: "Package name tidak valid. Contoh: com.zora.aplikasi"
      });
    }

    let parsedUrl;

    try {
      parsedUrl = new URL(cleanUrl);
    } catch {
      return res.status(400).json({
        success: false,
        message: "URL website tidak valid."
      });
    }

    if (
      !["https:", "http:"].includes(parsedUrl.protocol) ||
      !parsedUrl.hostname
    ) {
      return res.status(400).json({
        success: false,
        message: "URL harus menggunakan HTTP atau HTTPS."
      });
    }

    // Ambil token dari environment Vercel
    const token = process.env.GITHUB_TOKEN;

    if (!token) {
      return res.status(500).json({
        success: false,
        message: "GITHUB_TOKEN belum dipasang di Vercel."
      });
    }

    // Kirim permintaan ke GitHub Actions
    const githubResponse = await fetch(
      "https://api.github.com/repos/pemainevos7-eng/web-to-app/actions/workflows/build.yml/dispatches",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
          "User-Agent": "ZORA-BUILDER"
        },
        body: JSON.stringify({
          ref: "main",
          inputs: {
            app_name: cleanName,
            package_name: cleanPackage,
            website_url: parsedUrl.href
          }
        })
      }
    );

    // GitHub Actions workflow_dispatch normalnya membalas HTTP 204
    if (githubResponse.status !== 204) {
      let githubDetail = "";

      try {
        const data = await githubResponse.json();
        githubDetail = data.message || JSON.stringify(data);
      } catch {
        githubDetail = await githubResponse.text().catch(() => "");
      }

      console.error("GitHub API:", {
        status: githubResponse.status,
        detail: githubDetail
      });

      let message = "GitHub menolak permintaan build.";

      if (githubResponse.status === 401) {
        message = "Token GitHub tidak valid atau sudah kedaluwarsa.";
      } else if (githubResponse.status === 403) {
        message = "Token tidak memiliki izin Actions: Read and write.";
      } else if (githubResponse.status === 404) {
        message = "Repository atau file workflow tidak ditemukan.";
      } else if (githubResponse.status === 422) {
        message = "Input workflow tidak valid atau branch main tidak ditemukan.";
      }

      return res.status(502).json({
        success: false,
        message,
        githubStatus: githubResponse.status,
        detail: githubDetail || "GitHub tidak memberikan detail tambahan."
      });
    }

    return res.status(200).json({
      success: true,
      message: "Permintaan build berhasil dikirim!",
      actionsUrl:
        "https://github.com/pemainevos7-eng/web-to-app/actions"
    });

  } catch (error) {
    console.error("Build server error:", error);

    return res.status(500).json({
      success: false,
      message: "Server mengalami kesalahan.",
      detail: error.message || "Kesalahan tidak diketahui."
    });
  }
};
