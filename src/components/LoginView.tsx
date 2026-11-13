import React, { useState } from 'react';
import { Eye, EyeOff, FileSpreadsheet, Lock, MessageSquareText, User } from 'lucide-react';
import { login } from '../lib/api';
import type { UserPublic } from '../types';

interface LoginViewProps {
  onSuccess: (user: UserPublic) => void;
}

export const LoginView: React.FC<LoginViewProps> = ({ onSuccess }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!username.trim() || !password) {
      setError('Please enter your username/email and password.');
      return;
    }

    setLoading(true);
    try {
      const res = await login(username.trim(), password);
      onSuccess(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign in');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F4F7F5] flex flex-col justify-center items-center px-4 py-10">
      <div className="w-full max-w-[960px] bg-white border border-[#DCE4E0] rounded-xl overflow-hidden grid grid-cols-1 md:grid-cols-12 shadow-sm">
        <div className="md:col-span-5 bg-[#075E54] text-white p-8 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2.5 mb-8">
              <div className="w-9 h-9 rounded-lg bg-[#25D366]/20 border border-[#25D366]/40 flex items-center justify-center">
                <FileSpreadsheet className="w-5 h-5 text-[#25D366]" />
              </div>
              <span className="font-display text-lg font-bold tracking-tight whitespace-nowrap">
                OrderDesk
              </span>
            </div>

            <h1 className="font-display text-2xl font-bold leading-snug text-balance mb-3">
              Telecaller Data Entry & WhatsApp Dispatch
            </h1>
            <p className="text-sm text-emerald-100/85 leading-relaxed">
              Log daily customer bookings in a fast Excel-style sheet, track completed orders, and send multi-order cleaner lists straight to your WhatsApp group in English, Hindi, or Punjabi.
            </p>
          </div>

          <div className="mt-8 pt-6 border-t border-white/15 space-y-2.5 text-xs text-emerald-50/90">
            <div className="flex items-center gap-2.5">
              <FileSpreadsheet className="w-4 h-4 text-[#25D366] shrink-0" />
              <span>Inline Excel sheet editing & date-to-date filter</span>
            </div>
            <div className="flex items-center gap-2.5">
              <MessageSquareText className="w-4 h-4 text-[#25D366] shrink-0" />
              <span>One-click numbered cleaner list + Hindi/Punjabi translate</span>
            </div>
          </div>
        </div>

        <div className="md:col-span-7 p-8 sm:p-10 flex flex-col justify-center">
          <div className="mb-6">
            <h2 className="font-display text-xl font-bold text-slate-900">Sign in to Portal</h2>
            <p className="text-sm text-slate-500 mt-1">
              Enter your telecaller username or Super Admin email.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="login-username"
                className="block text-xs font-semibold text-slate-700 mb-1.5"
              >
                Username or Email
              </label>
              <div className="relative">
                <User className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="login-username"
                  type="text"
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="e.g. suhana or rkmehra331996@gmail.com"
                  className="w-full pl-9 pr-3 py-2.5 text-sm bg-white border border-[#DCE4E0] rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#128C7E] focus:ring-2 focus:ring-[#128C7E]/15"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="login-password"
                className="block text-xs font-semibold text-slate-700 mb-1.5"
              >
                Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  className="w-full pl-9 pr-10 py-2.5 text-sm bg-white border border-[#DCE4E0] rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#128C7E] focus:ring-2 focus:ring-[#128C7E]/15"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {error && (
              <div
                role="alert"
                className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2"
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 bg-[#128C7E] hover:bg-[#075E54] disabled:opacity-60 text-white text-sm font-semibold rounded-lg transition-colors cursor-pointer whitespace-nowrap"
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
