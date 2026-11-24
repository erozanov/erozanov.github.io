"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => SledomPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");
var import_child_process = require("child_process");
var path = __toESM(require("path"));
var fs = __toESM(require("fs"));
var DEFAULT_SETTINGS = {
  blogRepoPath: "/Users/erozanov/Projects/travel_blog",
  nodePath: "/opt/homebrew/bin/node",
  autoPush: true
};
var SledomPlugin = class extends import_obsidian.Plugin {
  constructor() {
    super(...arguments);
    this.settings = DEFAULT_SETTINGS;
  }
  async onload() {
    await this.loadSettings();
    this.addRibbonIcon("compass", "\u0421\u043B\u0435\u0434\u043E\u043C: \u041E\u043F\u0443\u0431\u043B\u0438\u043A\u043E\u0432\u0430\u0442\u044C \u0432 \u0431\u043B\u043E\u0433", () => {
      this.publishCurrentNote();
    });
    this.addCommand({
      id: "publish-active-note",
      name: "\u041E\u043F\u0443\u0431\u043B\u0438\u043A\u043E\u0432\u0430\u0442\u044C / \u043E\u0431\u043D\u043E\u0432\u0438\u0442\u044C \u0430\u043A\u0442\u0438\u0432\u043D\u0443\u044E \u0437\u0430\u043C\u0435\u0442\u043A\u0443 \u0432 \u0431\u043B\u043E\u0433\u0435",
      checkCallback: (checking) => {
        const activeFile = this.app.workspace.getActiveFile();
        if (activeFile && activeFile.extension === "md") {
          if (!checking) {
            this.publishCurrentNote();
          }
          return true;
        }
        return false;
      }
    });
    this.addCommand({
      id: "create-trip-template",
      name: "\u0412\u0441\u0442\u0430\u0432\u0438\u0442\u044C \u0448\u0430\u0431\u043B\u043E\u043D \u043D\u043E\u0432\u043E\u0439 \u043F\u043E\u0435\u0437\u0434\u043A\u0438 (mode: trip)",
      editorCallback: (editor) => {
        const template = `---
mode: trip
status: \u0433\u043E\u0442\u043E\u0432\u043E
id: new-trip
title: \u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435 \u043F\u043E\u0435\u0437\u0434\u043A\u0438
country: \u0421\u0442\u0440\u0430\u043D\u0430
number: "005"
startDate: ${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}
endDate: ${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}
summary: "\u041A\u0440\u0430\u0442\u043A\u043E\u0435 \u043E\u043F\u0438\u0441\u0430\u043D\u0438\u0435 \u043F\u043E\u0435\u0437\u0434\u043A\u0438 \u0434\u043B\u044F \u043A\u0430\u0440\u0442\u043E\u0447\u043A\u0438 \u0430\u0440\u0445\u0438\u0432\u0430."
cover: cover.jpg
coverAlt: "\u041E\u043F\u0438\u0441\u0430\u043D\u0438\u0435 \u043E\u0431\u043B\u043E\u0436\u043A\u0438"
featured: false
---

\u0417\u0434\u0435\u0441\u044C \u0432\u0441\u0442\u0443\u043F\u0438\u0442\u0435\u043B\u044C\u043D\u044B\u0439 \u0442\u0435\u043A\u0441\u0442 \u043F\u043E\u0435\u0437\u0434\u043A\u0438, \u043A\u043E\u0442\u043E\u0440\u044B\u0439 \u043F\u043E\u044F\u0432\u0438\u0442\u0441\u044F \u0432 \u043D\u0430\u0447\u0430\u043B\u0435 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u044B.

\`\`\`cities
\u0413\u043E\u0440\u043E\u0434 1 | city-1 | 0.0 | 0.0 | \u041A\u043E\u0440\u043E\u0442\u043A\u0438\u0439 \u0442\u044D\u0433\u043B\u0430\u0439\u043D \u0433\u043E\u0440\u043E\u0434\u0430 | city1.jpg | \u0424\u043E\u0442\u043E \u0433\u043E\u0440\u043E\u0434\u0430
\u0413\u043E\u0440\u043E\u0434 2 | city-2 | 0.0 | 0.0 | \u041A\u043E\u0440\u043E\u0442\u043A\u0438\u0439 \u0442\u044D\u0433\u043B\u0430\u0439\u043D \u0433\u043E\u0440\u043E\u0434\u0430 | city2.jpg | \u0424\u043E\u0442\u043E \u0433\u043E\u0440\u043E\u0434\u0430
\`\`\`
`;
        editor.replaceSelection(template);
      }
    });
    this.addSettingTab(new SledomSettingTab(this.app, this));
  }
  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
  getAbsoluteFilePath(file) {
    const adapter = this.app.vault.adapter;
    if (adapter.getBasePath) {
      return path.join(adapter.getBasePath(), file.path);
    }
    return file.path;
  }
  findNodeBinary() {
    if (this.settings.nodePath && fs.existsSync(this.settings.nodePath)) {
      return this.settings.nodePath;
    }
    const candidates = [
      "/opt/homebrew/bin/node",
      "/usr/local/bin/node",
      "/usr/bin/node"
    ];
    for (const cand of candidates) {
      if (fs.existsSync(cand)) return cand;
    }
    return "node";
  }
  async publishCurrentNote() {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) {
      new import_obsidian.Notice("\u041E\u0442\u043A\u0440\u043E\u0439\u0442\u0435 \u0437\u0430\u043C\u0435\u0442\u043A\u0443 \u0434\u043B\u044F \u043F\u0443\u0431\u043B\u0438\u043A\u0430\u0446\u0438\u0438.");
      return;
    }
    const noteFullPath = this.getAbsoluteFilePath(activeFile);
    const scriptPath = path.join(this.settings.blogRepoPath, "scripts", "publish-note.mjs");
    if (!fs.existsSync(this.settings.blogRepoPath)) {
      new import_obsidian.Notice(`\u041F\u0430\u043F\u043A\u0430 \u0440\u0435\u043F\u043E\u0437\u0438\u0442\u043E\u0440\u0438\u044F \u0431\u043B\u043E\u0433\u0430 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u0430: ${this.settings.blogRepoPath}`);
      return;
    }
    if (!fs.existsSync(scriptPath)) {
      new import_obsidian.Notice(`\u0421\u043A\u0440\u0438\u043F\u0442 \u043F\u0443\u0431\u043B\u0438\u043A\u0430\u0446\u0438\u0438 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D: ${scriptPath}`);
      return;
    }
    let content = await this.app.vault.read(activeFile);
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) {
      new import_obsidian.Notice("\u0423 \u0437\u0430\u043C\u0435\u0442\u043A\u0438 \u043D\u0435\u0442 \u0431\u043B\u043E\u043A\u0430 frontmatter (--- ... ---).");
      return;
    }
    const fm = fmMatch[1];
    const isTrip = /^mode:\s*trip/m.test(fm);
    const isReady = /^status:\s*готово/m.test(fm);
    const isPublished = /^status:\s*опубликовано/m.test(fm);
    if (isPublished) {
      new ConfirmUpdateModal(this.app, isTrip ? "\u043F\u043E\u0435\u0437\u0434\u043A\u0443" : "\u043C\u043E\u043C\u0435\u043D\u0442", async () => {
        const updated = content.replace(/^status:\s*опубликовано/m, "status: \u0433\u043E\u0442\u043E\u0432\u043E");
        await this.app.vault.modify(activeFile, updated);
        this.runPublishProcess(activeFile, noteFullPath, scriptPath);
      }).open();
      return;
    }
    if (!isReady) {
      new ConfirmPublishModal(this.app, isTrip ? "\u043F\u043E\u0435\u0437\u0434\u043A\u0443" : "\u043C\u043E\u043C\u0435\u043D\u0442", async () => {
        let updated = content;
        if (/^status:/m.test(updated)) {
          updated = updated.replace(/^status:\s*.*$/m, "status: \u0433\u043E\u0442\u043E\u0432\u043E");
        } else {
          updated = updated.replace(/^---\n/, "---\nstatus: \u0433\u043E\u0442\u043E\u0432\u043E\n");
        }
        await this.app.vault.modify(activeFile, updated);
        this.runPublishProcess(activeFile, noteFullPath, scriptPath);
      }).open();
      return;
    }
    this.runPublishProcess(activeFile, noteFullPath, scriptPath);
  }
  runPublishProcess(file, noteFullPath, scriptPath) {
    const nodeBin = this.findNodeBinary();
    const notice = new import_obsidian.Notice("\u23F3 \u041F\u0443\u0431\u043B\u0438\u043A\u0443\u0435\u043C \u0432 \u0431\u043B\u043E\u0433...", 0);
    const args = [scriptPath, noteFullPath];
    if (!this.settings.autoPush) {
      args.push("--no-push");
    }
    const env = {
      ...process.env,
      PATH: `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH || ""}`
    };
    (0, import_child_process.execFile)(nodeBin, args, { env, cwd: this.settings.blogRepoPath }, (error, stdout, stderr) => {
      notice.hide();
      if (error) {
        console.error("\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u0443\u0431\u043B\u0438\u043A\u0430\u0446\u0438\u0438:", stderr || stdout || error.message);
        new OutputModal(this.app, "\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u0440\u0438 \u043F\u0443\u0431\u043B\u0438\u043A\u0430\u0446\u0438\u0438", stderr || stdout || error.message, false).open();
        return;
      }
      console.log("\u041F\u0443\u0431\u043B\u0438\u043A\u0430\u0446\u0438\u044F \u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043D\u0430:", stdout);
      new OutputModal(this.app, "\u0423\u0441\u043F\u0435\u0448\u043D\u043E \u043E\u043F\u0443\u0431\u043B\u0438\u043A\u043E\u0432\u0430\u043D\u043E!", stdout, true).open();
    });
  }
};
var ConfirmUpdateModal = class extends import_obsidian.Modal {
  constructor(app, entityType, onConfirm) {
    super(app);
    this.entityType = entityType;
    this.onConfirm = onConfirm;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: `\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C ${this.entityType}?` });
    contentEl.createEl("p", {
      text: `\u042D\u0442\u0430 \u0437\u0430\u043C\u0435\u0442\u043A\u0430 \u0443\u0436\u0435 \u0431\u044B\u043B\u0430 \u043E\u043F\u0443\u0431\u043B\u0438\u043A\u043E\u0432\u0430\u043D\u0430. \u041F\u0440\u0438 \u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u0438\u0438 \u0441\u043A\u0440\u0438\u043F\u0442 \u0437\u0430\u043D\u043E\u0432\u043E \u043E\u0431\u0440\u0430\u0431\u043E\u0442\u0430\u0435\u0442 \u0444\u0430\u0439\u043B\u044B \u0438 \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442 \u043E\u0431\u043D\u043E\u0432\u043B\u0451\u043D\u043D\u044B\u0435 \u0434\u0430\u043D\u043D\u044B\u0435 \u043D\u0430 \u0441\u0430\u0439\u0442.`
    });
    const btnContainer = contentEl.createDiv({ cls: "sledom-buttons" });
    const cancelBtn = btnContainer.createEl("button", { text: "\u041E\u0442\u043C\u0435\u043D\u0430" });
    cancelBtn.addEventListener("click", () => this.close());
    const okBtn = btnContainer.createEl("button", {
      text: "\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C \u043D\u0430 \u0441\u0430\u0439\u0442\u0435",
      cls: "mod-cta"
    });
    okBtn.style.marginLeft = "8px";
    okBtn.addEventListener("click", () => {
      this.close();
      this.onConfirm();
    });
  }
  onClose() {
    this.contentEl.empty();
  }
};
var ConfirmPublishModal = class extends import_obsidian.Modal {
  constructor(app, entityType, onConfirm) {
    super(app);
    this.entityType = entityType;
    this.onConfirm = onConfirm;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: `\u041E\u043F\u0443\u0431\u043B\u0438\u043A\u043E\u0432\u0430\u0442\u044C ${this.entityType}?` });
    contentEl.createEl("p", {
      text: `\u0412 \u0437\u0430\u043C\u0435\u0442\u043A\u0435 \u0441\u0442\u0430\u0442\u0443\u0441 \u0435\u0449\u0451 \u043D\u0435 \u0431\u044B\u043B \u043F\u043E\u043C\u0435\u0447\u0435\u043D \u043A\u0430\u043A \xAB\u0433\u043E\u0442\u043E\u0432\u043E\xBB. \u0423\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u0442\u044C \xABstatus: \u0433\u043E\u0442\u043E\u0432\u043E\xBB \u0438 \u043E\u0442\u043F\u0440\u0430\u0432\u0438\u0442\u044C \u043D\u0430 \u0441\u0430\u0439\u0442?`
    });
    const btnContainer = contentEl.createDiv({ cls: "sledom-buttons" });
    const cancelBtn = btnContainer.createEl("button", { text: "\u041E\u0442\u043C\u0435\u043D\u0430" });
    cancelBtn.addEventListener("click", () => this.close());
    const okBtn = btnContainer.createEl("button", {
      text: "\u041E\u043F\u0443\u0431\u043B\u0438\u043A\u043E\u0432\u0430\u0442\u044C",
      cls: "mod-cta"
    });
    okBtn.style.marginLeft = "8px";
    okBtn.addEventListener("click", () => {
      this.close();
      this.onConfirm();
    });
  }
  onClose() {
    this.contentEl.empty();
  }
};
var OutputModal = class extends import_obsidian.Modal {
  constructor(app, titleText, logText, isSuccess) {
    super(app);
    this.titleText = titleText;
    this.logText = logText;
    this.isSuccess = isSuccess;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    const h = contentEl.createEl("h2", { text: this.titleText });
    if (!this.isSuccess) {
      h.style.color = "var(--text-error)";
    }
    const pre = contentEl.createEl("pre");
    pre.style.whiteSpace = "pre-wrap";
    pre.style.maxHeight = "300px";
    pre.style.overflowY = "auto";
    pre.style.padding = "10px";
    pre.style.background = "var(--background-secondary)";
    pre.style.borderRadius = "6px";
    pre.style.fontSize = "0.85em";
    pre.setText(this.logText.trim());
    const urlMatch = this.logText.match(/https:\/\/erozanov\.github\.io[^\s]+/);
    if (urlMatch) {
      const p = contentEl.createEl("p");
      p.createSpan({ text: "\u0421\u0441\u044B\u043B\u043A\u0430: " });
      const a = p.createEl("a", { text: urlMatch[0], href: urlMatch[0] });
      a.style.wordBreak = "break-all";
    }
    const btnContainer = contentEl.createDiv({ cls: "sledom-buttons" });
    const closeBtn = btnContainer.createEl("button", { text: "\u0417\u0430\u043A\u0440\u044B\u0442\u044C" });
    closeBtn.addEventListener("click", () => this.close());
  }
  onClose() {
    this.contentEl.empty();
  }
};
var SledomSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "\u041D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438 \u043F\u0443\u0431\u043B\u0438\u043A\u0430\u0446\u0438\u0438 \u0432 \u0431\u043B\u043E\u0433 \xAB\u0421\u043B\u0435\u0434\u043E\u043C\xBB" });
    new import_obsidian.Setting(containerEl).setName("\u041F\u0443\u0442\u044C \u043A \u0440\u0435\u043F\u043E\u0437\u0438\u0442\u043E\u0440\u0438\u044E \u0431\u043B\u043E\u0433\u0430").setDesc("\u0410\u0431\u0441\u043E\u043B\u044E\u0442\u043D\u044B\u0439 \u043F\u0443\u0442\u044C \u043A \u043B\u043E\u043A\u0430\u043B\u044C\u043D\u043E\u0439 \u043F\u0430\u043F\u043A\u0435 \u043F\u0440\u043E\u0435\u043A\u0442\u0430 travel_blog").addText(
      (text) => text.setPlaceholder("/Users/erozanov/Projects/travel_blog").setValue(this.plugin.settings.blogRepoPath).onChange(async (value) => {
        this.plugin.settings.blogRepoPath = value.trim();
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("\u041F\u0443\u0442\u044C \u043A \u0431\u0438\u043D\u0430\u0440\u043D\u0438\u043A\u0443 Node.js").setDesc("\u041E\u0431\u044B\u0447\u043D\u043E /opt/homebrew/bin/node (\u043D\u0430 Apple Silicon Mac) \u0438\u043B\u0438 /usr/local/bin/node").addText(
      (text) => text.setPlaceholder("/opt/homebrew/bin/node").setValue(this.plugin.settings.nodePath).onChange(async (value) => {
        this.plugin.settings.nodePath = value.trim();
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("\u0410\u0432\u0442\u043E\u043C\u0430\u0442\u0438\u0447\u0435\u0441\u043A\u0438\u0439 Git Push").setDesc("\u041A\u043E\u043C\u043C\u0438\u0442\u0438\u0442\u044C \u0438 \u043F\u0443\u0448\u0438\u0442\u044C \u0438\u0437\u043C\u0435\u043D\u0435\u043D\u0438\u044F \u0441\u0440\u0430\u0437\u0443 \u043F\u0440\u0438 \u043F\u0443\u0431\u043B\u0438\u043A\u0430\u0446\u0438\u0438 (\u0437\u0430\u043F\u0443\u0441\u043A\u0430\u0435\u0442 \u0441\u0431\u043E\u0440\u043A\u0443 \u043D\u0430 GitHub Pages)").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.autoPush).onChange(async (value) => {
        this.plugin.settings.autoPush = value;
        await this.plugin.saveSettings();
      })
    );
  }
};
