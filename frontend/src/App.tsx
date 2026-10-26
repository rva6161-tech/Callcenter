import { Navigate, Route, Routes } from 'react-router-dom'
import ProtectedRoute from './components/ProtectedRoute'
import RequireRole from './components/RequireRole'
import Layout from './components/Layout'
import Home from './pages/Home'
import Login from './pages/Login'
import TeamsList from './pages/TeamsList'
import TeamDetail from './pages/TeamDetail'
import ShiftTypes from './pages/ShiftTypes'
import Schedule from './pages/Schedule'
import MySchedule from './pages/MySchedule'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<Home />} />
        <Route
          path="/teams"
          element={
            <RequireRole roles={['admin']}>
              <TeamsList />
            </RequireRole>
          }
        />
        <Route
          path="/teams/:id"
          element={
            <RequireRole roles={['admin', 'supervisor']}>
              <TeamDetail />
            </RequireRole>
          }
        />
        <Route
          path="/shift-types"
          element={
            <RequireRole roles={['admin', 'supervisor']}>
              <ShiftTypes />
            </RequireRole>
          }
        />
        <Route
          path="/schedule"
          element={
            <RequireRole roles={['admin', 'supervisor']}>
              <Schedule />
            </RequireRole>
          }
        />
        <Route path="/my-schedule" element={<MySchedule />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
