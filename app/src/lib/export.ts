import JSZip from "jszip";
import yaml from "js-yaml";
import type { Project } from "../types";
import markdownSpecDoc from "../../../docs/结构化幻灯片Markdown规范.md?raw";
import { PALETTES } from "./palettes";
import { collectDeckFiles } from "./compile";

const paletteLines = PALETTES.map(
  (palette) =>
    `- ${palette.name}（${palette.id}）：主色 ${palette.primary}，点缀色 ${palette.accent}，强调文字 ${palette.accentText}。`,
).join("\n");

function safeName(name: string): string {
  return name
    .trim()
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 60) || "厦与珈";
}

async function sha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

const latexReadme = (name: string) => `# ${name} LaTeX 工程

这个文件夹可以直接编译。

## 编译方式

在终端进入本文件夹，执行

\`\`\`bash
tectonic main.tex
\`\`\`

也可以把整个文件夹上传到 Overleaf，选择 XeLaTeX 编译。

## 文件说明

- \`main.tex\` 由厦与珈生成，内容区可以在应用里继续编辑。
- \`beamerthemeXYJ.sty\` 与其余 \`.sty\` 文件控制版式，不要修改。
- \`assets/\` 存放校徽与图片。

## 字体

模板使用 FandolHei。Tectonic 与 TeX Live 的 ctex 组件自带这个字体。
`;

const usageDoc = `# 厦与珈 AI 包

这个包把当前项目的内容、模板、写作规范和校验清单放在一起。把整个文件夹交给任意 AI 会话，让它先读 \`01-系统提示词.md\`。

## 两种输出模式

### 内容模式

AI 只修改 \`03-内容.yaml\`。你把修改后的 YAML 交回厦与珈，应用重新生成 LaTeX。这个模式适合扩写、改写、翻译与调整章节。

### 工程模式

AI 输出完整的 \`main.tex\`。固定前导区不能改动，正文只能改 \`% BEGIN CONTENT\` 与 \`% END CONTENT\` 之间的内容。这个模式适合需要精细控制版式的场景。

### 结构化 Markdown 模式

\`07-结构化Markdown规范.md\` 是另一种输入方式。让 AI 先读这份规范，再读知识文本，输出一份结构化 Markdown。回到厦与珈首页，点击“从 Markdown 新建”，应用会在本地校验、导入图片并新建项目。这个模式不联网。

## 交付要求

1. 内容模式只交回 \`03-内容.yaml\`。
2. 工程模式只交回 \`main.tex\`。
3. 结构化 Markdown 模式只交回一份符合 \`07-结构化Markdown规范.md\` 的 Markdown。
4. 交付前逐项核对 \`06-校验清单.md\`。
5. 不要修改主题文件、字体、字号、颜色、页边距与编号规则。
`;

const systemDoc = `# 系统提示词

你是一名中文 Beamer 学术幻灯片编辑。你的任务是修改 \`03-内容.yaml\` 或 \`main.tex\` 的内容区，让文稿符合下面的写作与版式规范。

## 输入

- \`03-内容.yaml\` 保存当前项目的全部内容。
- \`04-模板/项目骨架.tex\` 是固定骨架。
- \`04-模板/preamble.sha256\` 保存固定前导区的校验值。
- \`05-示例/完整示例.tex\` 是当前项目的完整编译样例。

## 输出契约

### 内容模式

只输出完整的 \`03-内容.yaml\`。字段与现有文件一致，不新增字段，不删除必填字段。页面对象保留 \`layout\`，内容块保留 \`pane\`，表格保留 \`placement\` 和逐列 \`aligns\`。

### 工程模式

输出完整的 \`main.tex\`。只允许改动 \`% BEGIN CONTENT\` 与 \`% END CONTENT\` 之间的内容。前导区必须与骨架逐字一致，哈希必须等于 \`preamble.sha256\`。

## 绝对禁止

- 修改前导区、主题文件、字体、字号、颜色、页边距与编号规则。
- 新造 LaTeX 命令或环境。
- 在正文写 \`\\fontsize\`、\`\\color\`、\`\\vspace\`、自定义 \`tabular\` 列宽或手动编号。
- 使用红色字体或红色背景。
- 在图注或表注里手写“图 1”“表 1”。编号由模板生成。
- 一段正文里混入多个主题。

## 允许的内容命令

- \`\\kw{文字}\` 行内重点。
- \`\\begin{definitionbox}\`、\`\\begin{theorembox}\`、\`\\begin{consensusbox}\`、\`\\begin{groupbox}\` 四类内容块。
- \`\\begin{itemize}\` 与 \`\\item\`。
- 行内数学 \`$...$\` 与行间数学 \`$$...$$\`。
- \`03-内容.yaml\` 中的 \`**重点**\` 与 \`$数学$\` 标记。
- 行内格式：\`//斜体//\`、\`__下划线__\`、\`~~删除线~~\`、\`^^上划线^^\`、\`==高亮==\`。
- 文本块需要整块居中时，在对应块的 YAML 中写 \`align: center\`。

## 内容规则

1. 每页只讲一个主题。同一主题的连续几页可以共用页面标题，不必每页另起标题。
2. 页面标题控制在 18 个汉字以内，组标题控制在 16 个汉字以内。
3. 每条要点围绕一个判断展开，正文不设固定字数上限。
4. 定义、定理、共识、编组的正文使用完整句。
5. 要点句末不加句号。
6. 图注放在图下，表注放在表上。
7. 术语前后保持一致。
8. 重点标记只给关键术语，每页不超过 3 处。
9. 中文正文遵守 \`02-写作规范.md\`。
10. 分版页面写 \`layout\`，每个内容块写所属 \`pane\`。全页只有 pane 0，上下或左右是 0、1，四分是 0 到 3。
11. 表格的 \`aligns\` 按列写单元格文字对齐，\`placement\` 写整表在页面或版面中的位置，两者不能混用。
12. 每个要点块可以写 \`title\` 组标题，不超过 16 个汉字，要概括这一组的共同判断，不口语化。组标题是否写由你判断，这一组有共同判断就写，只是并列事实就省略。要点正文写 \`text\`，不设固定字数上限。辅助说明写 \`notes\`。多个要点块纵向排列。
13. 一页有图片或表格任意一种时，尽量只搭配一组要点，不要两组。
14. 代码写在代码块的 code 字段里，注释行以 #、//、%、-- 开头。文献按 APA 写，一条一段。脚注放在页面底部，自动编号，每页最多两条。
15. 单个内容块独占一个版面时，可以写 \`centered: true\` 让它垂直居中。默认不写，按原来的顶部对齐。这个选项不改变字体字号，不强制使用。
16. 结尾页由应用自动生成。中间文字写在 \`ending.title\`，汇报人和汇报时间取自封面的 presenter 和日期字段。不要手写结尾页。

## 交付前

逐项核对 \`06-校验清单.md\`。任何一项不通过就继续修改，不要交付半成品。
`;

const styleDoc = `# 写作规范

## 中文写作

1. 不使用直角引号，统一使用中文双引号。
2. 不使用“代价”一词。根据语境改用“风险”“损失”“后果”。
3. 正文不使用全角冒号与全角分号。英文文献并列的 APA 分号例外。
4. 不使用“基线”“缺口”“研究空白”“填补空白”等模板词。
5. 不使用“提供了工具”“提供了框架”这类工程语言。改用新闻传播学术语。
6. 每一句写完整主谓宾。不写省略句、半截话、无主句。

## 幻灯片写作

1. 每页只讲一个主题。标题写清这一页的判断或概念。同一主题的连续几页可以共用页面标题，不必每页另起。
2. 页面标题控制在 18 个汉字以内，组标题控制在 16 个汉字以内。组标题要概括这一组的共同判断，不口语化。
3. 每条要点围绕一个判断展开，正文不设固定字数上限。
4. 定义写完整定义，定理写清条件与结论，共识写一句可复述的结论，编组写清这一组内容的共同判断。
5. 要点句末不加句号。辅助说明写完整句子，不设字数上限。
6. 重点只标关键术语。每页不超过 3 处。
7. 数学公式用 LaTeX 写在 \`$...$\` 或 \`$$...$$\` 中。不要用 Unicode 下标和特殊符号代替公式。
8. 图注写在图下，表注写在表上。图注和表注都不手写编号。
9. 表格表头在上，首列可以设为行标题。单元格文字保持简短。
10. 一页放不下的内容拆成两页，不缩小字号。
11. 每个要点块可以写 \`title\` 组标题，不超过 16 个汉字，要概括这一组的共同判断，不口语化。组标题是否写由你判断，这一组有共同判断就写，只是并列事实就省略。要点正文写 \`text\`，不设固定字数上限。辅助说明写 \`notes\`。多个要点块纵向排列。辅助说明与正文同字号。
12. 一页有图片或表格任意一种时，尽量只搭配一组要点，不要两组。
13. 代码块用等宽字体，注释行以 #、//、%、-- 开头。文献块按 APA 写，悬挂缩进。脚注放在页面底部，自动编号，字体小，默认浅灰色，每页最多两条。
14. 单个内容块独占一个版面时，可以写 \`centered: true\` 让它垂直居中。默认不写，按原来的顶部对齐。这个选项不改变字体字号，不强制使用。
15. 结尾页固定，中间文字由 \`ending.title\` 控制。汇报人和汇报时间取自封面的 presenter 和日期字段。

## 版式令牌

- 字体: 中文 FandolHei，西文 Latin Modern Sans，数学 CMR。
- 页面标题: 12pt。
- 块标题: 8pt。
- 正文: 7pt，要点行距 10.6pt，块正文行距 11.3pt。
- 图注与表注: 5pt。
- 正文颜色: #1F2328。
- 次级文字: #5F6368。
${paletteLines}
- 页面背景: 白色。
- 页边距: 左右各 8 毫米。

## 行内格式

- \`**文字**\` 输出为模板重点色加粗。
- \`//文字//\` 输出为斜体。
- \`__文字__\` 输出为下划线。
- \`~~文字~~\` 输出为删除线。
- \`^^文字^^\` 输出为上划线。
- \`==文字==\` 输出为模板浅色高亮。
- 这六种标记可以嵌套，数学公式仍写在 \`$...$\` 内。

## YAML 对齐和版面字段

- 页面对象的 \`layout\` 存 \`full\`、\`rows\`、\`cols\` 或 \`grid\`。
- 每个内容块对象的 \`pane\` 存 0 到 3 的整数。全页只有 0，上下或左右是 0、1，四分是左上 0、右上 1、左下 2、右下 3。
- 表格对象的 \`aligns\` 按列存单元格文字对齐，取 \`left\`、\`center\` 或 \`right\`。
- 表格对象的 \`placement\` 存整表位置，取 \`left\`、\`center\` 或 \`right\`。表注跟着整张表移动，并在表宽内居中。
- 要点对象的 \`aligns\` 按要点正文的每个换行存 \`left\` 或 \`center\`。
- 要点对象的 \`noteAligns\` 是二维数组，按每条辅助说明的每个换行存 \`left\` 或 \`center\`。
- 没有对齐字段的旧项目，要点按左对齐读取，表格整表位置按居中读取。

## LaTeX 内容层

只允许使用这些命令与环境:

- \`\\kw{文字}\`
- \`definitionbox\`、\`theorembox\`、\`consensusbox\`、\`groupbox\`
- \`itemize\` 与 \`item\`
- \`$...$\` 与 \`$$...$$\`

图片、表格、封面与目录由应用生成，AI 不手写这三类结构。
`;

const checklistDoc = `# 校验清单

## 结构

- [ ] 前导区与 \`04-模板/项目骨架.tex\` 逐字一致。
- [ ] 前导区哈希等于 \`04-模板/preamble.sha256\`。
- [ ] 只改动了 \`% BEGIN CONTENT\` 与 \`% END CONTENT\` 之间的内容。
- [ ] 没有新增 LaTeX 命令或环境。

## 内容

- [ ] 每页只讲一个主题。同一主题的连续几页可以共用页面标题。
- [ ] 页面标题不超过 18 个汉字，组标题不超过 16 个汉字，标题概括、不口语化。
- [ ] 如果写了组标题，不超过 16 个汉字，标题概括、不口语化。
- [ ] 有图片或表格的页面尽量只配一组要点。
- [ ] 代码注释按行首符号写在代码块里，文献按 APA 写，脚注放在页面底部且不超过两条。
- [ ] 如果写了 centered，该版面只有一个内容块，字体字号没有变化。
- [ ] 结尾页中间文字写在 ending.title，汇报人和汇报时间取自封面字段。
- [ ] 每个要点的 text 和 notes 没有混用，正文不设固定字数上限。
- [ ] 多个要点块纵向排列。
- [ ] 每页重点不超过 3 处。
- [ ] 行内格式标记成对闭合。
- [ ] 定义、定理、共识、编组的正文是完整句。
- [ ] 要点句末没有句号。
- [ ] 图注在图下，表注在表上。
- [ ] 图注和表注没有手写编号。
- [ ] 页面 \`layout\` 合法，分版页面的每个内容块都有合法的 \`pane\`。
- [ ] 表格 \`aligns\` 按列设置，\`placement\` 设置整表位置，两者没有混用。
- [ ] 内容里没有新增红色字体或红色背景。
- [ ] 没有全角冒号与全角分号。
- [ ] 没有“代价”“基线”“缺口”“研究空白”“填补空白”。
- [ ] 没有直角引号。

## 数学与排版

- [ ] 所有数学公式都放在 \`$...$\` 或 \`$$...$$\` 中。
- [ ] 没有 Unicode 下标、上标或希腊字母直接混在正文里。
- [ ] 表格表头在上。
- [ ] 一页没有溢出。

## 编译

- [ ] \`tectonic main.tex\` 编译通过。
- [ ] 编译日志没有缺字警告。
`;

export interface ExportBundle {
  base64: string;
  fileName: string;
}

export async function buildLatexZip(
  project: Project,
  projectPath: string,
): Promise<ExportBundle> {
  const { files } = await collectDeckFiles(project, projectPath);
  const zip = new JSZip();
  for (const file of files) {
    if (file.text !== undefined) {
      zip.file(file.path, file.text);
    } else if (file.base64 !== undefined) {
      zip.file(file.path, file.base64, { base64: true });
    }
  }
  zip.file("README.md", latexReadme(project.name));
  const base64 = await zip.generateAsync({
    type: "base64",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
  return { base64, fileName: `${safeName(project.name)}-LaTeX.zip` };
}

export async function buildAiPackage(
  project: Project,
  projectPath: string,
): Promise<ExportBundle> {
  const { files, deck } = await collectDeckFiles(project, projectPath);
  const zip = new JSZip();
  const beginMarker = "\\begin{document}";
  const endMarker = "\\end{document}";
  const beginIndex = deck.tex.indexOf(beginMarker);
  const endIndex = deck.tex.lastIndexOf(endMarker);
  if (beginIndex < 0 || endIndex < beginIndex) {
    throw new Error("生成的 LaTeX 骨架不完整");
  }
  const preamble = deck.tex.slice(0, beginIndex);
  const body = deck.tex.slice(beginIndex + beginMarker.length, endIndex);
  const skeleton = `${preamble}${beginMarker}
% BEGIN CONTENT
${body}${endMarker}
`;
  zip.file("00-使用说明.md", usageDoc);
  zip.file("01-系统提示词.md", systemDoc);
  zip.file("02-写作规范.md", styleDoc);
  zip.file("03-内容.yaml", yaml.dump(project, { lineWidth: 120, noRefs: true }));
  zip.file("04-模板/项目骨架.tex", skeleton);
  zip.file("04-模板/preamble.sha256", `${await sha256(preamble)}\n`);
  zip.file("06-校验清单.md", checklistDoc);
  zip.file("07-结构化Markdown规范.md", markdownSpecDoc);
  for (const file of files) {
    if (file.path === "main.tex") {
      if (file.text !== undefined) zip.file("05-示例/完整示例.tex", file.text);
      continue;
    }
    if (file.text !== undefined) {
      zip.file(`04-模板/${file.path}`, file.text);
      zip.file(`05-示例/${file.path}`, file.text);
    } else if (file.base64 !== undefined) {
      zip.file(`04-模板/${file.path}`, file.base64, { base64: true });
      zip.file(`05-示例/${file.path}`, file.base64, { base64: true });
    }
  }
  zip.file(
    "05-示例/README.md",
    "这个文件夹可以独立编译。\n\n```bash\ntectonic 完整示例.tex\n```\n",
  );
  const base64 = await zip.generateAsync({
    type: "base64",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
  return { base64, fileName: `${safeName(project.name)}-AI包.zip` };
}
