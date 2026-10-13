import type { PluginServerContext } from "@getpaseo/plugin/server";
import { fileDiff, listFiles, palettes, searchDiff } from "./server/diff";
import { listEditors, openInEditor, openProjectInEditor } from "./server/editors";
import { storeGet, storeSet } from "./server/store";
import { listThreads, replyToThread } from "./server/threads";
import { getViewed, setViewed } from "./server/viewed";
import {
  editorsRpc,
  fileDiffRpc,
  openInEditorRpc,
  openProjectInEditorRpc,
  filesRpc,
  palettesRpc,
  searchRpc,
  storeGetRpc,
  storeSetRpc,
  threadReplyRpc,
  threadsRpc,
  viewedGetRpc,
  viewedSetRpc,
} from "./shared/diff";

export default function contribute(server: PluginServerContext) {
  server.handle(filesRpc, listFiles);
  server.handle(fileDiffRpc, fileDiff);
  server.handle(palettesRpc, palettes);
  server.handle(editorsRpc, listEditors);
  server.handle(openInEditorRpc, openInEditor);
  server.handle(openProjectInEditorRpc, openProjectInEditor);
  server.handle(searchRpc, searchDiff);
  server.handle(viewedGetRpc, getViewed);
  server.handle(viewedSetRpc, setViewed);
  server.handle(threadsRpc, listThreads);
  server.handle(threadReplyRpc, replyToThread);
  server.handle(storeGetRpc, storeGet);
  server.handle(storeSetRpc, storeSet);
  return () => {};
}
