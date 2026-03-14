/* ========================================
   GAZO98 - ファイル読み込み（File API / D&D）
   ======================================== */

const FileLoader = (() => {
    const ACCEPTED_TYPES = [
        'image/jpeg', 'image/png', 'image/bmp',
        'image/webp', 'image/gif'
    ];

    let dropZone = null;
    let fileInput = null;
    let onLoadCallback = null;

    function init(callback) {
        onLoadCallback = callback;
        dropZone = document.getElementById('drop-zone');
        fileInput = document.getElementById('file-input');

        setupDropZone();
        setupFileInput();
    }

    function setupDropZone() {
        if (!dropZone) return;

        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.add('drag-over');
        });

        dropZone.addEventListener('dragleave', (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.remove('drag-over');
        });

        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.remove('drag-over');

            const files = e.dataTransfer.files;
            if (files.length > 0) {
                handleFile(files[0]);
            }
        });

        dropZone.addEventListener('click', (e) => {
            if (e.target.id !== 'btn-open' && !e.target.closest('#btn-open')) {
                openDialog();
            }
        });
    }

    function setupFileInput() {
        if (!fileInput) return;

        fileInput.addEventListener('change', () => {
            if (fileInput.files.length > 0) {
                handleFile(fileInput.files[0]);
                fileInput.value = '';
            }
        });
    }

    function openDialog() {
        if (fileInput) {
            fileInput.click();
        }
    }

    function handleFile(file) {
        if (!ACCEPTED_TYPES.includes(file.type)) {
            Dialog.alert('エラー', '対応していないファイル形式です。<br>JPEG / PNG / BMP / WebP / GIF に対応しています。');
            return;
        }

        StatusBar.setMessage('画像を読み込み中...');

        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                if (onLoadCallback) {
                    onLoadCallback(img, file.name);
                }
            };
            img.onerror = () => {
                Dialog.alert('エラー', '画像の読み込みに失敗しました。');
                StatusBar.setMessage('Ready');
            };
            img.src = e.target.result;
        };
        reader.onerror = () => {
            Dialog.alert('エラー', 'ファイルの読み込みに失敗しました。');
            StatusBar.setMessage('Ready');
        };
        reader.readAsDataURL(file);
    }

    return { init, openDialog };
})();
