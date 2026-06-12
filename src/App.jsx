import { Navigate, Route, Routes } from 'react-router-dom';
import ConnectPage from './pages/ConnectPage';
import DesktopPage from './pages/DesktopPage';
import DiffPage from './pages/DiffPage';
import HadexExplorationPage from './pages/HadexExplorationPage';
import MyProfilePage from './pages/MyProfilePage';
import PublicProfilePage from './pages/PublicProfilePage';
import ReviewPage from './pages/ReviewPage';
import RequireAuth from './components/RequireAuth';

function withAuthGate(element) {
  return <RequireAuth>{element}</RequireAuth>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/connect" element={<ConnectPage />} />
      <Route path="/connect/" element={<ConnectPage />} />
      <Route path="/desktop" element={<DesktopPage />} />
      <Route path="/desktop/" element={<DesktopPage />} />
      <Route path="/desktop/connect" element={<ConnectPage />} />
      <Route path="/desktop/connect/" element={<ConnectPage />} />
      <Route path="/diff" element={withAuthGate(<DiffPage />)} />
      <Route path="/diff/" element={withAuthGate(<DiffPage />)} />
      <Route path="/diff/profile" element={withAuthGate(<MyProfilePage />)} />
      <Route path="/diff/profile/" element={withAuthGate(<MyProfilePage />)} />
      <Route path="/diff/review" element={<ReviewPage />} />
      <Route path="/diff/review/" element={<ReviewPage />} />
      <Route path="/explorations/hadex" element={<HadexExplorationPage />} />
      <Route path="/explorations/hadex/" element={<HadexExplorationPage />} />
      <Route path="/diff/:handle" element={withAuthGate(<PublicProfilePage />)} />
      <Route path="/diff/:handle/" element={withAuthGate(<PublicProfilePage />)} />
      <Route path="/" element={<Navigate to="/diff/" replace />} />
      <Route path="*" element={null} />
    </Routes>
  );
}
