import type { Project } from "../types";
import { plainText } from "./text";

export const DEFAULT_ENDING_TITLE = "恳请各位批判指正";

export function endingTitle(project: Project): string {
  return project.ending?.title?.trim() || DEFAULT_ENDING_TITLE;
}

export function endingPresenter(project: Project): string {
  const field = project.cover.fields.find((item) => item.role === "presenter");
  return field ? plainText(field.value).trim() : "";
}

export function endingDate(project: Project): string {
  const field =
    project.cover.fields.find((item) => /日期|时间/.test(item.label)) ??
    project.cover.fields.find((item) => item.size === "md" || item.size === "sm");
  return field ? plainText(field.value).trim() : "";
}
