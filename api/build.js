
module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      message: "Method not allowed"
    });
  }

  try {
    const { appName, packageName, websiteUrl } = req.body || {};

    if (!appName || !packageName || !websiteUrl) {
      return res.status(400).json({
        success: false,
        message: "Semua data wajib diisi."
      });
    }

    const validPackage =
      /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/.test(packageName);

    if (!validPackage) {
      return res.status(400).json({
        success: false,
        message: "Format package name tidak valid."
      });
    }

    let parsedUrl;

    try {
      parsedUrl = new URL(websiteUrl);
    } catch {
      return res.status(400).json({
        success: false,
        message: "URL website tidak valid."
      });
    }

    if (!["https:", "http:"].includes(parsedUrl.protocol)) {
      return res.status(400).json({
        success: false,
        message: "URL harus menggunakan HTTP atau HTTPS."
      });
    }

    const token = process.env.GITHUB_TOKEN;

    if (!token) {
      return res.status(500).json({
        success: false,
        message: "Build server belum dikonfigurasi."
      });
    }

    const response = await fetch(
      "https://api.github.com/repos/pemainevos7-eng/web-to-app/actions/workflows/build.yml/dispatches",
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
          inputs: {
            app_name: String(appName).slice(0, 40),
            package_name: packageName,
            website_url: parsedUrl.href
          }
        })
      }
    );

    if (!response.ok) {
      const detail = await response.text();
      console.error("GitHub error:", detail);

      return res.status(502).json({
        success: false,
        message: "GitHub gagal menerima permintaan build."
      });
    }

    return res.status(200).json({
      success: true,
      message: "Permintaan build berhasil dikirim ke GitHub Actions."
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      message: "Terjadi kesalahan pada server."
    });
  }
};
