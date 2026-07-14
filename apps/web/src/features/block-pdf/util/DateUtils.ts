export function reformatPdfjsDate(
  modificationDate: string | null,
  creationDate: string | null
) {
  let editDate: Date = new Date();
  if (modificationDate != null) editDate = new Date(modificationDate);
  else if (creationDate != null) editDate = new Date(creationDate);
  if (isNaN(editDate.getFullYear())) {
    let tempDate = modificationDate ?? creationDate;
    const split = tempDate?.match(/.{1,2}/g);
    // Imported Pdfjs annotation date may come in the format "D:YYYYMMDDHHMMSS-GMT" but needs to be "YYYY-MM-DDTHH:MM:SS-GMT"
    if (split != null && split[0] === 'D:') {
      split[8] = '-' + split[8].charAt(1);
      split[9] = split[9].charAt(0);
      tempDate =
        split[1] +
        split[2] +
        '-' +
        split[3] +
        '-' +
        split[4] +
        'T' +
        split[5] +
        ':' +
        split[6] +
        ':' +
        split[7] +
        split[8] +
        split[9] +
        ':' +
        split[10];
      editDate = new Date(tempDate);
    }
  }
  return editDate;
}

export function getCleanHumanReadableCurrentDateTime() {
  const now = new Date();
  const datePart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(
    2,
    '0'
  )}-${String(now.getDate()).padStart(2, '0')}`;
  const timePart = `${String(now.getHours()).padStart(2, '0')}${String(
    now.getMinutes()
  ).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
  return `${datePart}-${timePart}`;
}
