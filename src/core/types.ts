export type PackageManager = "pnpm" | "npm" | "yarn" | "bun" | null;

export type MainLanguage =
  | "TypeScript"
  | "JavaScript"
  | "Python"
  | "Java"
  | "C#"
  | "C/C++"
  | "Rust"
  | "Go";

export type IssueSeverity = "error" | "warning" | "info";

export type DoctorStatus = "healthy" | "needs attention" | "broken";

export interface PackageJson {
  name?: string;
  description?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

export interface ProjectScan {
  projectName: string;
  packageDescription?: string;
  projectOverview?: string;
  projectOverviewSource?: "package.json" | "README.md";
  absolutePath: string;
  isGitRepository: boolean;
  hasAgents: boolean;
  hasReadme: boolean;
  packageManager: PackageManager;
  languages: MainLanguage[];
  frameworks: string[];
  scripts: Record<string, string>;
  importantFiles: string[];
  projectStructure: string[];
}

export interface ValidationIssue {
  severity: IssueSeverity;
  code: string;
  message: string;
}

export interface ValidationSummary {
  errors: number;
  warnings: number;
  infos: number;
}

export interface AgentsValidationResult {
  scan: ProjectScan;
  issues: ValidationIssue[];
  summary: ValidationSummary;
  status: DoctorStatus;
}
