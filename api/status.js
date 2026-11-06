
const REPO = "pemainevos7-eng/web-to-app";
const WORKFLOW = "build.yml";

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

    const response = await fetch(
      `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/runs?event=workflow_dispatch&branch=main&per_page=50`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28"
        }
      }
    );

    if (!response.ok) {
      return res.status(502).json({
        success: false,
        message: "Gagal memeriksa status build.",
        githubStatus: response.status
      });
    }

    const data = await response.json();

    const run = (data.workflow_runs || []).find(item =>
      item.display_title === `ZORA BUILD - ${requestId}`
    );

    if (!run) {
      return res.status(200).json({
        success: true,
        found: false,
        status: "waiting",
        message: "Menunggu proses build ditemukan."
      });
    }

    const artifactsResponse = await fetch(
      `https://api.github.com/repos/${REPO}/actions/runs/${run.id}/artifacts`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28"
        }
      }
    );

    let artifactReady = false;

    if (artifactsResponse.ok) {
      const artifacts = await artifactsResponse.json();

      artifactReady = (artifacts.artifacts || []).some(item =>
        item.name === `ZORA-BUILDER-${requestId}` &&
        !item.expired
      );
    }

    return res.status(200).json({
      success: true,
      found: true,
      requestId,
      runId: run.id,
      status: run.status,
      conclusion: run.conclusion,
      artifactReady,
      message:
        run.status === "completed"
          ? run.conclusion === "success"
            ? "APK berhasil dibuat."
            : "Build gagal."
          : "APK sedang diproses."
    });

  } catch (error) {
    console.error("STATUS ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Gagal membaca status build."
    });
  }
};
