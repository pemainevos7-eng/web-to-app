
const OWNER = "pemainevos7-eng";
const REPO = "web-to-app";
const API = "https://api.github.com";

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");

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

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28"
  };

  async function githubGet(path) {
    const response = await fetch(`${API}${path}`, { headers });

    if (!response.ok) {
      const details = await response.text();
      throw new Error(
        `GitHub API ${response.status}: ${details.slice(0, 500)}`
      );
    }

    return response.json();
  }

  try {
    const data = await githubGet(
      `/repos/${OWNER}/${REPO}/actions/workflows/build.yml/runs?per_page=50`
    );

    const run = (data.workflow_runs || []).find(
      item => item.display_title === `ZORA BUILD - ${requestId}`
    );

    if (!run) {
      return res.status(200).json({
        success: true,
        found: false,
        requestId,
        status: "queued",
        conclusion: null,
        artifactReady: false,
        activities: [
          {
            name: "Permintaan build diterima",
            status: "completed",
            conclusion: "success"
          },
          {
            name: "Menunggu GitHub Actions",
            status: "queued",
            conclusion: null
          }
        ]
      });
    }

    // Ambil status job dan setiap langkah workflow.
    const jobsData = await githubGet(
      `/repos/${OWNER}/${REPO}/actions/runs/${run.id}/jobs?per_page=100`
    );

    const jobs = (jobsData.jobs || []).map(job => ({
      name: job.name,
      status: job.status,
      conclusion: job.conclusion,
      steps: (job.steps || []).map(step => ({
        name: step.name,
        number: step.number,
        status: step.status,
        conclusion: step.conclusion
      }))
    }));

    const activities = [];

    for (const job of jobs) {
      activities.push({
        name: job.name,
        status: job.status,
        conclusion: job.conclusion,
        type: "job"
      });

      for (const step of job.steps) {
        activities.push({
          name: step.name,
          number: step.number,
          status: step.status,
          conclusion: step.conclusion,
          type: "step"
        });
      }
    }

    let artifactReady = false;
    const artifactName = `ZORA-BUILDER-${requestId}`;

    if (run.status === "completed" && run.conclusion === "success") {
      const artifactData = await githubGet(
        `/repos/${OWNER}/${REPO}/actions/runs/${run.id}/artifacts`
      );

      artifactReady = (artifactData.artifacts || []).some(
        artifact =>
          artifact.name === artifactName &&
          !artifact.expired
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
      actionsUrl: run.html_url,
      createdAt: run.created_at,
      updatedAt: run.updated_at,
      jobs,
      activities
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      error: "Gagal mengecek status build GitHub Actions.",
      details: error.message
    });
  }
};
