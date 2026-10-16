/**
 * ============================================================================
 * CONTROLADOR DE LA INTERFAZ DE ACTUALIZACIONES (ESTILO SIMPLE JQUAKE)
 * ============================================================================
 */
import { UPDATES_CONFIG } from './updates-config.js';

export class UpdatesUIManager {
  constructor() {
    this.pages = Array.isArray(UPDATES_CONFIG.pages) && UPDATES_CONFIG.pages.length > 0 
      ? UPDATES_CONFIG.pages 
      : [{ page: 1, title: 'Actualizaciones', versions: [] }];
    this.currentPageIndex = 0;
    this.storageKey = 'sismosmex_hide_updates_modal_v860';

    this.initElements();
    this.bindEvents();

    // La UI debe mostrarse SIEMPRE al inicio a menos que se haya marcado "no volver a mostrar"
    const hideOnStartup = localStorage.getItem(this.storageKey) === 'true';
    if (!hideOnStartup) {
      setTimeout(() => {
        this.open();
      }, 350);
    }
  }

  initElements() {
    this.modal = document.getElementById('updatesModal');
    this.modalTitle = document.getElementById('updatesModalTitle');
    this.modalBody = document.getElementById('updatesModalBody');
    this.btnClose = document.getElementById('btnUpdatesClose');
    this.btnOk = document.getElementById('btnUpdatesOk');
    this.pageControls = document.getElementById('updatesPageControls');
    this.dontShowCheckbox = document.getElementById('updatesDontShowAgain');
  }

  bindEvents() {
    this.btnClose?.addEventListener('click', () => this.handleDismiss());
    this.btnOk?.addEventListener('click', () => this.handleDismiss());

    this.modal?.addEventListener('click', (e) => {
      if (e.target === this.modal) {
        this.handleDismiss();
      }
    });

    this.dontShowCheckbox?.addEventListener('change', (e) => {
      if (e.target.checked) {
        localStorage.setItem(this.storageKey, 'true');
      } else {
        localStorage.removeItem(this.storageKey);
      }
    });

    window.addEventListener('keydown', (e) => {
      if (!this.isOpen()) return;
      if (e.key === 'Escape' || e.key === 'Enter') this.handleDismiss();
      if (e.key === 'ArrowLeft') this.prevPage();
      if (e.key === 'ArrowRight') this.nextPage();
    });
  }

  isOpen() {
    return this.modal && this.modal.style.display !== 'none' && this.modal.classList.contains('active');
  }

  open(pageIndex = 0) {
    if (!this.modal) return;
    this.currentPageIndex = Math.max(0, Math.min(this.pages.length - 1, pageIndex));
    this.render();
    this.modal.style.display = 'flex';
    requestAnimationFrame(() => {
      this.modal.classList.add('active');
    });
  }

  handleDismiss() {
    // Si el usuario marcó el checkbox antes de cerrar
    if (this.dontShowCheckbox) {
      if (this.dontShowCheckbox.checked) {
        localStorage.setItem(this.storageKey, 'true');
      } else {
        localStorage.removeItem(this.storageKey);
      }
    }
    this.close();
  }

  close() {
    if (!this.modal) return;
    this.modal.classList.remove('active');
    setTimeout(() => {
      if (!this.modal.classList.contains('active')) {
        this.modal.style.display = 'none';
      }
    }, 150);
  }

  nextPage() {
    if (this.currentPageIndex < this.pages.length - 1) {
      this.currentPageIndex++;
      this.render();
    }
  }

  prevPage() {
    if (this.currentPageIndex > 0) {
      this.currentPageIndex--;
      this.render();
    }
  }

  render() {
    const pageData = this.pages[this.currentPageIndex] || this.pages[0];
    if (!pageData) return;

    // Título superior
    if (this.modalTitle) {
      this.modalTitle.innerText = pageData.title || UPDATES_CONFIG.title || 'Actualizaciones';
    }

    // Estado del checkbox sincronizado con localStorage
    if (this.dontShowCheckbox) {
      this.dontShowCheckbox.checked = localStorage.getItem(this.storageKey) === 'true';
    }

    // Controles de paginación si hay más de 1 página
    if (this.pageControls) {
      if (this.pages.length > 1) {
        this.pageControls.style.display = 'flex';
        this.pageControls.innerHTML = `
          <button type="button" class="updates-page-nav-arrow" id="btnPagePrev" ${this.currentPageIndex === 0 ? 'disabled' : ''} title="Página anterior">‹</button>
          <span class="updates-page-num">${this.currentPageIndex + 1} / ${this.pages.length}</span>
          <button type="button" class="updates-page-nav-arrow" id="btnPageNext" ${this.currentPageIndex === this.pages.length - 1 ? 'disabled' : ''} title="Siguiente página">›</button>
        `;

        document.getElementById('btnPagePrev')?.addEventListener('click', () => this.prevPage());
        document.getElementById('btnPageNext')?.addEventListener('click', () => this.nextPage());
      } else {
        this.pageControls.style.display = 'none';
      }
    }

    // Cuerpo de versiones estilo JQuake (Versión a la izquierda, cambios a la derecha)
    if (this.modalBody) {
      const versions = Array.isArray(pageData.versions) ? pageData.versions : [];
      if (versions.length === 0) {
        this.modalBody.innerHTML = '<div style="color: #94a3b8; font-size: 13px; text-align: center; padding: 20px;">Sin registros para esta página.</div>';
        return;
      }

      this.modalBody.innerHTML = versions.map((v) => {
        const changes = Array.isArray(v.changes) ? v.changes : [];
        const changesHtml = changes.map(ch => `<li class="update-bullet-item"><span class="update-bullet-dot">•</span><span class="update-bullet-text">${ch}</span></li>`).join('');

        return `
          <div class="update-version-row">
            <div class="update-version-label">${v.version || ''}</div>
            <ul class="update-version-bullets">
              ${changesHtml}
            </ul>
          </div>
        `;
      }).join('');
    }
  }
}
