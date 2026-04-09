import { cp, mkdir, readdir, rm, stat, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const rootDir = process.cwd();
const distDir = path.join(rootDir, "dist");
const webDir = path.join(distDir, "web");
const skipTranscode = process.argv.includes("--skip-transcode");
const keepSourceMedia = process.argv.includes("--keep-source-media");
const concurrency = Math.max(2, Math.min(os.cpus().length, 6));
const copyEntries = ["data", "tyrano", "index.html"];

async function main() {
  await rm(distDir, { recursive: true, force: true });
  await mkdir(webDir, { recursive: true });

  for (const entry of copyEntries) {
    await cp(path.join(rootDir, entry), path.join(webDir, entry), {
      force: true,
      recursive: true
    });
  }

  const mediaFiles = await collectMediaFiles(path.join(webDir, "data"));
  const audioJobs = mediaFiles.audio.map((sourcePath) => ({
    kind: "audio",
    sourcePath,
    outputPath: sourcePath.replace(/\.ogg$/i, ".m4a")
  }));
  const videoJobs = mediaFiles.video.map((sourcePath) => ({
    kind: "video",
    sourcePath,
    outputPath: sourcePath.replace(/\.webm$/i, ".mp4")
  }));
  const jobs = audioJobs.concat(videoJobs);

  if (!skipTranscode) {
    await ensureCommand("ffmpeg", [
      "ffmpeg is required to build the iOS bundle.",
      "Install ffmpeg locally or run the GitHub Actions workflow, which installs it automatically."
    ]);

    await runInPool(jobs, concurrency, transcodeMedia);

    if (!keepSourceMedia) {
      await Promise.all(jobs.map((job) => unlink(job.sourcePath).catch(() => {})));
    }
  }

  const verification = await verifyBundle(jobs, {
    requireConvertedFiles: !skipTranscode
  });

  await writeFile(
    path.join(distDir, "ios-build-report.json"),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        skipTranscode,
        keepSourceMedia,
        counts: {
          audio: audioJobs.length,
          video: videoJobs.length
        },
        verification
      },
      null,
      2
    ),
    "utf8"
  );

  console.log(
    [
      `Prepared iOS web bundle at ${webDir}`,
      `Audio files: ${audioJobs.length}`,
      `Video files: ${videoJobs.length}`,
      skipTranscode ? "Transcode skipped." : "Transcode complete."
    ].join("\n")
  );
}

async function collectMediaFiles(startDir) {
  const audio = [];
  const video = [];

  async function walk(currentDir) {
    const entries = await readdir(currentDir, { withFileTypes: true });

    await Promise.all(
      entries.map(async (entry) => {
        const absolutePath = path.join(currentDir, entry.name);

        if (entry.isDirectory()) {
          await walk(absolutePath);
          return;
        }

        if (/\.ogg$/i.test(entry.name)) {
          audio.push(absolutePath);
        } else if (/\.webm$/i.test(entry.name)) {
          video.push(absolutePath);
        }
      })
    );
  }

  await walk(startDir);
  return { audio, video };
}

async function transcodeMedia(job) {
  const sourceStat = await stat(job.sourcePath);
  const outputExists = await stat(job.outputPath).catch(() => null);

  if (outputExists && outputExists.mtimeMs >= sourceStat.mtimeMs) {
    return;
  }

  await mkdir(path.dirname(job.outputPath), { recursive: true });

  const ffmpegArgs =
    job.kind === "audio"
      ? [
          "-y",
          "-i",
          job.sourcePath,
          "-vn",
          "-c:a",
          "aac",
          "-b:a",
          "128k",
          "-movflags",
          "+faststart",
          job.outputPath
        ]
      : [
          "-y",
          "-i",
          job.sourcePath,
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          "23",
          "-pix_fmt",
          "yuv420p",
          "-movflags",
          "+faststart",
          "-c:a",
          "aac",
          "-b:a",
          "128k",
          job.outputPath
        ];

  await runCommand("ffmpeg", ffmpegArgs);
}

async function verifyBundle(jobs, options) {
  const missingOutputs = [];

  for (const job of jobs) {
    if (!options.requireConvertedFiles) {
      continue;
    }

    try {
      await stat(job.outputPath);
    } catch {
      missingOutputs.push(path.relative(rootDir, job.outputPath));
    }
  }

  if (missingOutputs.length > 0) {
    throw new Error(
      [
        "The iOS bundle is incomplete.",
        "Missing converted media files:",
        missingOutputs.slice(0, 20).join("\n"),
        missingOutputs.length > 20 ? `...and ${missingOutputs.length - 20} more.` : ""
      ].join("\n")
    );
  }

  return {
    ok: true,
    missingOutputs
  };
}

async function ensureCommand(command, errorLines) {
  try {
    await runCommand(command, ["-version"], { quiet: true });
  } catch {
    throw new Error(errorLines.join("\n"));
  }
}

async function runInPool(items, limit, worker) {
  const queue = items.slice();
  const workers = [];

  for (let i = 0; i < limit; i += 1) {
    workers.push(
      (async () => {
        while (queue.length > 0) {
          const item = queue.shift();
          if (!item) {
            return;
          }
          await worker(item);
        }
      })()
    );
  }

  await Promise.all(workers);
}

async function runCommand(command, args, options = {}) {
  const quiet = Boolean(options.quiet);

  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      stdio: quiet ? "ignore" : "inherit"
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited with code ${code}`));
      }
    });
  });
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
