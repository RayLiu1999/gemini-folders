import { describe, expect, it } from 'vitest';
import { applyOperation, backupOf, emptyWorkspace, parseBackup, parseChatUrl, parseStore, validateWorkspace } from '../src/model';
import { environment, sampleWorkspace } from './fixtures';

describe('分類規則', () => {
  it('拒絕循環及搬移後超過三層的子樹，並保留原資料', () => {
    let ws = sampleWorkspace(); const first = ws.folders[0]!.id;
    ws = applyOperation(ws, { type: 'create-folder', parentId: first, name: '子項', color: 'blue' }, environment); const second = ws.folders[1]!.id;
    ws = applyOperation(ws, { type: 'create-folder', parentId: second, name: '第三層', color: 'blue' }, environment);
    expect(() => applyOperation(ws, { type: 'edit-folder', id: first, name: '工作', parentId: second, color: 'blue' })).toThrow(/循環/);
    const added = applyOperation(ws, { type: 'create-folder', parentId: null, name: '另一項', color: 'green' }, environment);
    expect(() => applyOperation(added, { type: 'edit-folder', id: first, name: '工作', parentId: added.folders[3]!.id, color: 'blue' })).toThrow(/最多 3 層/);
    expect(ws.folders[0]!.parentId).toBeNull();
  });
  it('同層名稱去除空白後不能重複，其他層可以使用同名', () => {
    const ws = sampleWorkspace();
    expect(() => applyOperation(ws, { type: 'create-folder', name: ' 工作 ', parentId: null, color: 'blue' }, environment)).toThrow(/同名/);
    expect(applyOperation(ws, { type: 'create-folder', name: '工作', parentId: ws.folders[0]!.id, color: 'blue' }, environment).folders).toHaveLength(2);
  });
  it('刪除整個分類樹時，聊天回到未分類且連結保留', () => {
    let ws = sampleWorkspace(); const root = ws.folders[0]!.id;
    ws = applyOperation(ws, { type: 'create-folder', name: '子項', parentId: root, color: 'blue' }, environment);
    ws = applyOperation(ws, { type: 'move-chats', ids: ws.chats.map(chat => chat.id), folderId: ws.folders[1]!.id });
    const next = applyOperation(ws, { type: 'delete-folder', id: root });
    expect(next.folders).toHaveLength(0); expect(next.chats).toHaveLength(2); expect(next.chats.every(chat => chat.folderId === null)).toBe(true);
    expect(next.chats[0]!.url).toBe(ws.chats[0]!.url);
  });
  it('批次移動有不存在的聊天時整批拒絕', () => {
    const ws = sampleWorkspace();
    expect(() => applyOperation(ws, { type: 'move-chats', ids: [ws.chats[0]!.id, 'missing-chat'], folderId: ws.folders[0]!.id })).toThrow(/重新選取/);
    expect(ws.chats[0]!.folderId).toBeNull();
  });
  it('更新已收錄聊天的標題時保留分類及首次收錄時間', () => {
    let ws = sampleWorkspace(); ws = applyOperation(ws, { type: 'move-chats', ids: [ws.chats[0]!.id], folderId: ws.folders[0]!.id });
    const next = applyOperation(ws, { type: 'ingest', chats: [{ ...ws.chats[0]!, title: '重新命名' }] });
    expect(next.chats).toHaveLength(2); expect(next.chats[0]!.folderId).toBe(ws.folders[0]!.id); expect(next.chats[0]!.firstSeenAt).toBe(ws.chats[0]!.firstSeenAt);
  });
});

describe('備份與資料驗證', () => {
  it.each(['https://evil.example/app/aaaaaaaaaaaaaaaa', 'javascript:alert(1)', 'https://gemini.google.com/share/aaaaaaaaaaaaaaaa', 'https://evil.example/?url=https://gemini.google.com/app/aaaaaaaaaaaaaaaa'])('拒絕非聊天連結 %s', value => {
    expect(parseChatUrl(value)).toBeNull();
  });
  it('接受語言參數與帳號路徑，但保存穩定的聊天連結', () => {
    expect(parseChatUrl('https://gemini.google.com/u/2/app/aaaaaaaaaaaaaaaa?hl=zh-TW&authuser=2')).toEqual({ id: 'aaaaaaaaaaaaaaaa', url: 'https://gemini.google.com/app/aaaaaaaaaaaaaaaa' });
  });
  it('備份可還原，並依選擇處理既有聊天分類', () => {
    const original = sampleWorkspace();
    const backup = parseBackup(JSON.parse(JSON.stringify(backupOf(original))));
    const restored = applyOperation(emptyWorkspace('restored', '還原工作區'), { type: 'import', backup, conflict: 'keep' });
    expect(restored.folders).toEqual(original.folders); expect(restored.chats).toEqual(original.chats);
    const modified = applyOperation(original, { type: 'move-chats', ids: [original.chats[0]!.id], folderId: original.folders[0]!.id });
    expect(applyOperation(modified, { type: 'import', backup, conflict: 'keep' }).chats[0]!.folderId).toBe(original.folders[0]!.id);
    expect(applyOperation(modified, { type: 'import', backup, conflict: 'incoming' }).chats[0]!.folderId).toBeNull();
  });
  it('匯入時合併同名同層資料夾並正確對應聊天', () => {
    const target = sampleWorkspace(); let incoming = sampleWorkspace('incoming');
    incoming = applyOperation(incoming, { type: 'move-chats', ids: [incoming.chats[0]!.id], folderId: incoming.folders[0]!.id });
    const next = applyOperation(target, { type: 'import', backup: backupOf(incoming), conflict: 'incoming' });
    expect(next.folders).toHaveLength(1); expect(next.chats[0]!.folderId).toBe(target.folders[0]!.id);
  });
  it('不會把未知版本或損壞資料當成空資料清除', () => {
    expect(() => parseStore({ version: 2, workspaces: [] })).toThrow(/原資料不會被清除/);
    const ws = sampleWorkspace(); ws.chats[0]!.folderId = 'missing'; expect(() => validateWorkspace(ws)).toThrow(/不存在/);
  });
});
