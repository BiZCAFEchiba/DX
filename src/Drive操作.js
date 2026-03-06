// ============================================================
// driveService.gs - Google Drive操作（PDF取得・ゴミ箱移動）
// ============================================================

/**
 * 指定フォルダ内のPDFファイル一覧を取得する
 * @param {string} folderId - Google DriveフォルダID
 * @returns {GoogleAppsScript.Drive.File[]} PDFファイルの配列
 */
function getShiftPdfsFromDrive(folderId) {
  try {
    const folder = DriveApp.getFolderById(folderId);
    const files = folder.getFilesByType(MimeType.PDF);
    const pdfFiles = [];

    while (files.hasNext()) {
      pdfFiles.push(files.next());
    }

    Logger.log('PDFファイル数: ' + pdfFiles.length);
    return pdfFiles;
  } catch (e) {
    Logger.log('Drive取得エラー: ' + e.message);
    return [];
  }
}

/**
 * PDFファイルをゴミ箱に移動する
 * @param {GoogleAppsScript.Drive.File} file
 */
function trashPdfFile(file) {
  try {
    file.setTrashed(true);
    Logger.log('ゴミ箱に移動: ' + file.getName());
  } catch (e) {
    Logger.log('ゴミ箱移動エラー: ' + e.message);
  }
}
