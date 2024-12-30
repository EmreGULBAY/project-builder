#!/usr/bin/env node
import inquirer from "inquirer";
import fs from "fs-extra";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import handlebars from "handlebars";

const currentFilePath = fileURLToPath(import.meta.url);
const packageDir = path.dirname(path.dirname(currentFilePath));

const REQUIRED_NODE_VERSION = "20.0.0";

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
  [key: string]: unknown;
}

const BASE_DEPENDENCIES = {
  modern: {
    devDependencies: {
      "@types/node": "^20.10.5",
      typescript: "^5.3.3",
      "ts-node": "^10.9.2",
      nodemon: "^3.0.2",
      eslint: "^8.56.0",
      "@typescript-eslint/parser": "^6.15.0",
      "@typescript-eslint/eslint-plugin": "^6.15.0",
      prettier: "^3.1.1",
      "eslint-config-prettier": "^9.1.0",
      "eslint-plugin-prettier": "^5.0.1",
    },
  },
  legacy: {
    devDependencies: {
      "@types/node": "^14.x",
      typescript: "^4.x",
      "ts-node": "^9.x",
      nodemon: "^2.x",
      eslint: "^7.32.0",
      "@typescript-eslint/parser": "^4.33.0",
      "@typescript-eslint/eslint-plugin": "^4.33.0",
      prettier: "^2.8.8",
      "eslint-config-prettier": "^8.5.0",
      "eslint-plugin-prettier": "^4.2.1",
    },
  },
};

const EXPRESS_DEPENDENCIES = {
  modern: {
    dependencies: {
      express: "^4.18.2",
      dotenv: "^16.3.1",
    },
    devDependencies: {
      "@types/express": "^4.17.21",
    },
  },
  legacy: {
    dependencies: {
      express: "^4.17.1",
      dotenv: "^8.2.0",
    },
    devDependencies: {
      "@types/express": "^4.17.13",
    },
  },
};

interface TemplateData {
  node_version: string;
  project_name: string;
  entrypoint: string;
  secrets: {
    GITHUB_TOKEN: string;
  };
  github: {
    run_number: string;
    actor: string;
  };
}

function getCurrentNodeMajorVersion(): string {
  const currentVersion = process.version.slice(1);
  return currentVersion.split(".")[0];
}

function checkNodeVersion(): boolean {
  const currentVersion = process.version.slice(1);
  const currentParts = currentVersion.split(".").map(Number);
  const requiredParts = REQUIRED_NODE_VERSION.split(".").map(Number);

  const isVersionValid = currentParts[0] >= requiredParts[0];

  if (!isVersionValid) {
    console.warn(
      "\x1b[33m%s\x1b[0m",
      `⚠️  Warning: You are using Node.js ${currentVersion}`
    );
    console.warn(
      "\x1b[33m%s\x1b[0m",
      `📌  This project recommends Node.js ${REQUIRED_NODE_VERSION} or higher`
    );
    console.log(
      "\x1b[36m%s\x1b[0m",
      `💡 Consider upgrading Node.js for better compatibility:`
    );
    console.log("\x1b[36m%s\x1b[0m", `   https://nodejs.org/\n`);
  }
  return isVersionValid;
}

async function updatePackageJson(
  useExpress: boolean,
  isNewNode: boolean
): Promise<void> {
  const packageJsonPath = path.join(process.cwd(), "package.json");
  const packageJson = JSON.parse(
    await fs.readFile(packageJsonPath, "utf-8")
  ) as PackageJson;

  const versionType = isNewNode ? "modern" : "legacy";
  const baseDeps = BASE_DEPENDENCIES[versionType];

  packageJson.devDependencies = {
    ...packageJson.devDependencies,
    ...baseDeps.devDependencies,
  };

  packageJson.scripts = {
    ...packageJson.scripts,
    build: "tsc",
    start: useExpress ? "node dist/server.js" : "node dist/main.js",
    dev: useExpress ? "nodemon src/server.ts" : "nodemon src/main.ts",
  };

  if (useExpress) {
    const expressDeps = EXPRESS_DEPENDENCIES[versionType];
    packageJson.dependencies = {
      ...packageJson.dependencies,
      ...expressDeps.dependencies,
    };
    packageJson.devDependencies = {
      ...packageJson.devDependencies,
      ...expressDeps.devDependencies,
    };
  }

  await fs.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2));
}

async function readTemplateFile(fileName: string): Promise<string> {
  const filePath = path.join(packageDir, "static", fileName);
  return fs.readFile(filePath, "utf-8");
}

async function getProjectName(): Promise<string> {
  const packageJsonPath = path.join(process.cwd(), "package.json");
  const packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf-8"));
  return packageJson.name || "my-app";
}

async function createFileFromTemplate(
  templateName: string,
  outputPath: string,
  data: TemplateData
): Promise<void> {
  const templateContent = await readTemplateFile(templateName);
  const template = handlebars.compile(templateContent);
  const result = template(data);
  await fs.writeFile(path.join(process.cwd(), outputPath), result);
}

async function setupGitHubWorkflow(templateData: TemplateData): Promise<void> {
  const workflowDir = path.join(process.cwd(), ".github", "workflows");
  await fs.mkdirp(workflowDir);

  await createFileFromTemplate(
    "build.txt",
    path.join(".github", "workflows", "build.yaml"),
    templateData
  );
}

async function init(): Promise<void> {
  console.log("🚀 Initializing project...\n");

  const isNewNode = checkNodeVersion();

  const answers = await inquirer.prompt([
    {
      type: "confirm",
      name: "useExpress",
      message: "Would you like to use Express.js in your project?",
      default: true,
    },
  ]);

  try {
    fs.mkdirSync("src", { recursive: true });

    const templateData: TemplateData = {
      node_version: getCurrentNodeMajorVersion(),
      entrypoint: answers.useExpress ? "dist/server.js" : "dist/main.js",
      project_name: await getProjectName(),
      secrets: {
        GITHUB_TOKEN: "{{ secrets.GITHUB_TOKEN }}",
      },
      github: {
        run_number: "{{ github.run_number }}",
        actor: "{{ github.actor }}",
      },
    };

    await createFileFromTemplate("docker.txt", "Dockerfile", templateData);
    await setupGitHubWorkflow(templateData);
    const gitignoreContent = await readTemplateFile("gitignore.txt");
    const eslintignoreContent = await readTemplateFile("eslintignore.txt");
    const eslintrcContent = await readTemplateFile("eslintrc.txt");
    const dockerignoreContent = await readTemplateFile("dockerignore.txt");
    const prettierrcContent = await readTemplateFile("prettierrc.txt");
    const readmeContent = await readTemplateFile("readme.txt");

    if (answers.useExpress) {
      console.log("\n📦 Setting up Express.js with TypeScript...");

      const appContent = await readTemplateFile("app.txt");
      const serverContent = await readTemplateFile("server.txt");

      await fs.writeFile(path.join(process.cwd(), "src/app.ts"), appContent);
      await fs.writeFile(
        path.join(process.cwd(), "src/server.ts"),
        serverContent
      );
    } else {
      console.log("\n📦 Setting up basic TypeScript project...");

      const mainContent = await readTemplateFile("main.txt");
      await fs.writeFile(path.join(process.cwd(), "src/main.ts"), mainContent);
    }
    await fs.writeFile(
      path.join(process.cwd(), ".gitignore"),
      gitignoreContent
    );
    await fs.writeFile(
      path.join(process.cwd(), ".eslintignore"),
      eslintignoreContent
    );
    await fs.writeFile(
      path.join(process.cwd(), ".eslintrc.json"),
      eslintrcContent
    );
    await fs.writeFile(
      path.join(process.cwd(), ".dockerignore"),
      dockerignoreContent
    );
    await fs.writeFile(
      path.join(process.cwd(), ".prettierrc"),
      prettierrcContent
    );
    await fs.writeFile(
      path.join(process.cwd(), "README.md"),
      readmeContent
    );
    const tsconfigContent = await readTemplateFile("tsconfig.txt");
    await fs.writeFile(
      path.join(process.cwd(), "tsconfig.json"),
      tsconfigContent
    );

    await updatePackageJson(answers.useExpress, isNewNode);

    console.log("\n✅ Project setup completed!");
    console.log("\n📝 Next steps:");
    console.log("1. Run: npm ci");
    console.log("2. Run: npm run dev (to start development server)");
    console.log("3. Run: npm run build (to build for production)");
    console.log("4. Run: npm start (to run production build)\n");
  } catch (error) {
    console.error("\n❌ Error setting up project:", error);
    process.exit(1);
  }
}

init().catch(console.error);
