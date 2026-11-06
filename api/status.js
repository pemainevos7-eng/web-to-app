
const OWNER = "pemainevos7-eng";
const REPO = "web-to-app";
const API = "https://api.github.com";

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({
      success: false,
      error: "Gunakan metode GET."
    });
  }

  const token = process.env.GITHUB_TOKEN;

  if (!token) {
    return res.status(500).json({
      success: false,
      error: "GITHUB_TOKEN belum dipasang."
    });
  }

  const requestId = req.query?.requestId;

  if (!requestId || !/^[a-f0-9-]{36}$/i.test(requestId)) {
    return res.status(400).json({
      success: false,
      error: "Request ID tidak valid."
    });
  }

  try {
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    };

    const runsResponse = await fetch(
      `${API}/repos/${OWNER}/${REPO}/actions/workflows/build.yml/runs?per_page=50`,
      { headers }
    );

    if (!runsResponse.ok) {
      const details = await runsResponse.text();

      return res.status(runsResponse.status).json({
        success: false,
        error: "Gagal membaca status GitHub Actions.",
        details: details.slice(0, 1000)
      });
    }

    const data = await runsResponse.json();

    const run = (data.workflow_runs || []).find(
      item => item.display_title === `ZORA BUILD - ${requestId}`
    );

    if (!run) {
      return res.status(200).json({
        success: true,
        found: false,
        status: "queued",
        message: "Menunggu build terdeteksi."
      });
    }

    let artifactReady = false;
    let artifactName = `ZORA-BUILDER-${requestId}`;

    if (run.status === "completed" && run.conclusion === "success") {
      const artifactResponse = await fetch(
        `${API}/repos/${OWNER}/${REPO}/actions/runs/${run.id}/artifacts`,
        { headers }
      );

      if (artifactResponse.ok) {
        const artifactData = await artifactResponse.json();

        artifactReady = (artifactData.artifacts || []).some(
          artifact =>
            artifact.name === artifactName &&
            !artifact.expired
        );
      }
    }

    return res.status(200).json({
      success: true,
      found: true,
      requestId,
      runId: run.id,
      status: run.status,
      conclusion: run.conclusion,
      artifactReady,
      actionsUrl: run.html_url
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      error: "Gagal mengecek status build.",
      details: error.message
    });
  }
};
