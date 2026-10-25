import { Navigate, Route, Routes } from 'react-router-dom';
import BasicLayout from '@/layouts/BasicLayout';
import RequireAuth from '@/components/RequireAuth';
import Login from '@/pages/Login';
import Register from '@/pages/Register';
import Review from '@/pages/Review';
import Dashboard from '@/pages/Dashboard';
import Documents from '@/pages/Documents';
import Rules from '@/pages/Rules';
import Kb from '@/pages/Kb';
import Evals from '@/pages/Evals';
import Providers from '@/pages/Providers';
import Traces from '@/pages/Traces';

export default function App() {
  return (
    <Routes>
      {/* 公开路由：登录 / 注册 */}
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      {/* 应用路由：全部走守卫，未登录跳 /login 并记录来源 */}
      <Route
        path="/"
        element={
          <RequireAuth>
            <BasicLayout />
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to="/review" replace />} />
        <Route path="review" element={<Review />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="documents" element={<Documents />} />
        <Route path="rules" element={<Rules />} />
        <Route path="kb" element={<Kb />} />
        <Route path="evals" element={<Evals />} />
        <Route path="providers" element={<Providers />} />
        <Route path="traces" element={<Traces />} />
      </Route>
      <Route path="*" element={<Navigate to="/review" replace />} />
    </Routes>
  );
}
