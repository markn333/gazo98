/* ========================================
   GAZO98 - ステータスバー
   ======================================== */

const StatusBar = (() => {
    let elResolution = null;
    let elColors = null;
    let elMessage = null;

    function init() {
        elResolution = document.getElementById('status-resolution');
        elColors = document.getElementById('status-colors');
        elMessage = document.getElementById('status-message');
    }

    function setResolution(width, height) {
        if (elResolution) {
            elResolution.textContent = width && height ? `${width}×${height}` : '---';
        }
    }

    function setColors(count) {
        if (elColors) {
            elColors.textContent = `${count}colors`;
        }
    }

    function setMessage(msg) {
        if (elMessage) {
            elMessage.textContent = msg;
        }
    }

    return { init, setResolution, setColors, setMessage };
})();
