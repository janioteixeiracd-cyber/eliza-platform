// Tiny singleton event bus for PWA install/update state. Lives outside
// React so registerSW.ts (called once from main.tsx, before the app tree
// exists) can publish events that any component — in the legacy app, /next,
// or /portal — subscribes to later via useInstallPrompt/useSWUpdate,
// without needing a shared context provider wrapping all three.
type Listener = () => void;

class PwaEventBus {
  deferredPrompt: any = null;
  installed = false;
  updateAvailable = false;
  private waitingWorker: ServiceWorker | null = null;
  private listeners = new Set<Listener>();

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit() {
    this.listeners.forEach((l) => l());
  }

  setDeferredPrompt(event: any) {
    this.deferredPrompt = event;
    this.emit();
  }

  clearDeferredPrompt() {
    this.deferredPrompt = null;
    this.emit();
  }

  setInstalled(value: boolean) {
    this.installed = value;
    this.emit();
  }

  setUpdateAvailable(worker: ServiceWorker | null) {
    this.updateAvailable = !!worker;
    this.waitingWorker = worker;
    this.emit();
  }

  activateWaitingWorker() {
    this.waitingWorker?.postMessage({ type: 'SKIP_WAITING' });
  }
}

export const pwaEvents = new PwaEventBus();
