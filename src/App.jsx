import { useEffect } from 'react';
import { useConvexAuth, useQuery } from 'convex/react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { api } from '../convex/_generated/api';
import { identifyPendoVisitorAfterInitialization } from './analytics/pendoIdentity';
import ConnectPage from './pages/ConnectPage';
import CompanyPage from './pages/CompanyPage';
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

function usePendoIdentity() {
  const { isAuthenticated } = useConvexAuth();
  const betaAccess = useQuery(api.beta.viewerAccess);
  const currentUser = useQuery(
    api.users.me,
    isAuthenticated && betaAccess?.allowed ? {} : 'skip',
  );

  useEffect(() => {
    return identifyPendoVisitorAfterInitialization(currentUser?.email);
  }, [currentUser?.email]);
}

export default function App() {
  usePendoIdentity();

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
      <Route path="/diff/company" element={withAuthGate(<CompanyPage />)} />
      <Route path="/diff/company/" element={withAuthGate(<CompanyPage />)} />
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
