import React from 'react';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

// Top-level safety net: without this, an uncaught error anywhere in the tree
// (e.g. a Firestore listener callback firing after signOut() invalidates the
// current token) unmounts the whole React app, leaving a blank white screen
// with no way to recover except a manual URL reload.
export default class AppErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[ELIZA] Uncaught error caught by AppErrorBoundary:', error, errorInfo);
  }

  handleReload = () => {
    window.location.href = '/';
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-white p-6">
          <div className="max-w-md w-full text-center space-y-4">
            <div className="w-14 h-14 mx-auto rounded-full bg-red-50 flex items-center justify-center text-2xl">
              ⚠️
            </div>
            <h1 className="text-lg font-bold text-slate-900">Algo deu errado</h1>
            <p className="text-sm text-slate-500">
              A ELIZA encontrou um erro inesperado e precisa recarregar a página. Nenhum dado foi perdido.
            </p>
            <button
              onClick={this.handleReload}
              className="w-full px-4 py-3 bg-slate-900 text-white font-bold text-sm rounded-xl"
            >
              Recarregar
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
