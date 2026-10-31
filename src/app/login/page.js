"use client";

import { signIn, useSession } from "next-auth/react";
import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { FaGoogle, FaKey, FaInfoCircle, FaArrowRight, FaEnvelope, FaExclamationTriangle } from "react-icons/fa";
import toast, { Toaster } from "react-hot-toast";
import { FAILURES } from "@/lib/auth-errors";

/**
 * What next-auth's own error codes mean.
 *
 * next-auth collapses every uncaught failure in the OAuth callback into one
 * code called "Callback", so the browser is never told what actually went
 * wrong. The detail is in the server log; this is what can honestly be said
 * in the page itself.
 */
const AUTH_ERROR_MESSAGES = {
  Callback:
    "Sign-in failed while talking to the server. The reason is in the deployment's logs.",
  OAuthCallback:
    "Google sign-in could not be completed. Please try again.",
  OAuthSignin:
    "Could not start the Google sign-in. Please try again.",
  CredentialsSignin:
    "That email address and password combination was not accepted.",
  OAuthAccountNotLinked:
    "This email address is already registered with a different sign-in method. Use email and password instead.",
  OAuthCreateAccount:
    "An account already exists for this email address. Sign in with email and password instead.",
  EmailCreateAccount:
    "An account already exists for this email address. Sign in with email and password instead.",
  AccessDenied: "Access was denied. Please try a different sign-in method.",
  Configuration:
    "Sign-in is not configured correctly on this deployment. Please contact the site owner.",
  Verification: "That sign-in link could not be verified. Please try again.",
  SessionRequired: "Please sign in to continue.",
  Signin: "Sign-in did not complete. Please try again.",
};

/**
 * Work out what to tell the visitor, if anything went wrong.
 *
 * `reason` is a category this app worked out for itself (the database is
 * unreachable, the schema is out of date, …); `error` is one of next-auth's
 * own codes.
 */
function explainFailure(reason, error) {
  // A category this app worked out for itself beats next-auth's own code,
  // because it names the cause rather than the symptom. But when the
  // category is the catch-all "internal", next-auth's code is the more
  // useful of the two: it at least says which step failed.
  if (reason && reason !== "internal") {
    return FAILURES[reason]?.signIn || "Sign-in failed. Please try again.";
  }
  if (error) {
    return (
      AUTH_ERROR_MESSAGES[error] ||
      FAILURES[reason]?.signIn ||
      "Sign-in failed. Please try again."
    );
  }
  if (reason) {
    return FAILURES[reason]?.signIn || "Sign-in failed. Please try again.";
  }
  return null;
}

function LoginContent() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("callbackUrl") || searchParams.get("next") || "/";
  // `reason` is a category this app worked out for itself; `error` is one of
  // next-auth's own codes. Either can be present after a failed sign-in.
  const reason = searchParams.get("reason");
  const failureMessage = explainFailure(reason, searchParams.get("error"));

  const [activeTab, setActiveTab] = useState("google"); // "google" | "email" | "apikey"
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [emailInput, setEmailInput] = useState("");
  const [passwordInput, setPasswordInput] = useState("");
  const [emailMode, setEmailMode] = useState("signin"); // "signin" | "signup"
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (status === "authenticated") {
      router.push(next);
    }
  }, [status, router, next]);

  useEffect(() => {
    if (failureMessage) {
      toast.error(failureMessage);
    }
  }, [failureMessage]);

  const handleApiKeyLogin = async (e) => {
    e.preventDefault();
    const key = apiKeyInput.trim();
    if (!key) {
      toast.error("Please enter a valid MuAPI key");
      return;
    }
    if (key.length < 5) {
      toast.error("API Key appears too short");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await signIn("credentials", {
        apiKey: key,
        redirect: false,
        callbackUrl: next,
      });

      if (res?.error) {
        toast.error(res.error || "Failed to sign in with API key");
      } else {
        toast.success("Signed in with API Key successfully!");
        router.push(next);
      }
    } catch (err) {
      console.error(err);
      toast.error("An error occurred during API key authentication");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEmailAuth = async (e) => {
    e.preventDefault();
    const email = emailInput.trim();
    const password = passwordInput;

    if (!email || !email.includes("@")) {
      toast.error("Please enter a valid email address");
      return;
    }
    if (!password) {
      toast.error("Please enter your password");
      return;
    }

    setIsSubmitting(true);
    try {
      if (emailMode === "signup") {
        const res = await fetch("/api/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        });
        // A response that is not JSON means the request never reached the
        // register route at all — most often the deployment is older than the
        // code that adds it.
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          if (res.status === 404) {
            toast.error(
              "This deployment does not include the register route. Push the latest commit and redeploy."
            );
            return;
          }
          toast.error(
            data?.error ||
              `Failed to create the account (HTTP ${res.status}).`
          );
          return;
        }
        toast.success("Account created! Signing you in...");
      }

      const res = await signIn("email", {
        email,
        password,
        redirect: false,
        callbackUrl: next,
      });

      if (res?.error) {
        toast.error(res.error || "Failed to sign in");
      } else {
        toast.success("Signed in successfully!");
        router.push(next);
      }
    } catch (err) {
      console.error(err);
      toast.error("An error occurred during email authentication");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-dvh flex items-center justify-center bg-bg-page px-6 text-primary-text select-none">
      <Toaster position="top-right" />
      <div className="relative bg-bg-card border border-divider w-full max-w-md rounded-xl p-8 space-y-6 shadow-2xl animate-scale-up">
        {failureMessage && (
          <div
            className={`flex items-start gap-2.5 border p-3.5 rounded text-[11px] leading-relaxed ${
              reason === "database_healthy"
                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                : "bg-red-500/10 border-red-500/30 text-red-300"
            }`}
          >
            {reason === "database_healthy" ? (
              <FaInfoCircle className="text-xs shrink-0 mt-0.5" />
            ) : (
              <FaExclamationTriangle className="text-xs shrink-0 mt-0.5" />
            )}
            <span>{failureMessage}</span>
          </div>
        )}

        <div className="flex flex-col items-center text-center space-y-3">
          <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center text-2xl text-primary font-black shadow-md shadow-primary/15">
            ✂️
          </div>
          <h2 className="text-2xl font-black uppercase tracking-tight">Sign In to Studio</h2>
          <p className="text-xs font-semibold text-secondary-text leading-relaxed px-2">
            Choose your preferred sign-in method: Google Account, Email, or a custom MuAPI Key.
          </p>
        </div>

        {/* Auth Method Selector Tabs */}
        <div className="flex bg-bg-page p-1 rounded-lg border border-divider/60">
          <button
            type="button"
            onClick={() => setActiveTab("google")}
            className={`flex-1 py-2 rounded-md text-xs font-bold transition-all flex items-center justify-center gap-2 ${
              activeTab === "google"
                ? "bg-bg-card text-white shadow-sm border border-divider/40"
                : "text-secondary-text hover:text-white"
            }`}
          >
            <FaGoogle className="text-red-400" />
            <span>Google</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("email")}
            className={`flex-1 py-2 rounded-md text-xs font-bold transition-all flex items-center justify-center gap-2 ${
              activeTab === "email"
                ? "bg-bg-card text-white shadow-sm border border-divider/40"
                : "text-secondary-text hover:text-white"
            }`}
          >
            <FaEnvelope className="text-primary" />
            <span>Email</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("apikey")}
            className={`flex-1 py-2 rounded-md text-xs font-bold transition-all flex items-center justify-center gap-2 ${
              activeTab === "apikey"
                ? "bg-bg-card text-white shadow-sm border border-divider/40"
                : "text-secondary-text hover:text-white"
            }`}
          >
            <FaKey className="text-amber-400" />
            <span>API Key</span>
          </button>
        </div>

        {/* Tab Content */}
        {activeTab === "google" ? (
          <div className="space-y-4 pt-2">
            <button
              onClick={() => signIn("google", { callbackUrl: next })}
              className="w-full py-3.5 bg-white text-neutral-900 rounded-full text-xs font-bold flex items-center justify-center gap-3 hover:opacity-90 transition-all shadow-md active:scale-[0.98] cursor-pointer"
            >
              <FaGoogle className="text-sm text-red-500" />
              <span>Continue with Google</span>
            </button>

            {/* Email sign-up is offered on its own tab, but a visitor who
                lands here should not have to go looking for it. */}
            <div className="flex items-center gap-3">
              <div className="h-px flex-1 bg-divider/60" />
              <span className="text-[10px] uppercase font-bold text-secondary-text tracking-wider">
                or
              </span>
              <div className="h-px flex-1 bg-divider/60" />
            </div>

            <button
              type="button"
              onClick={() => {
                setActiveTab("email");
                setEmailMode("signup");
              }}
              className="w-full py-3 bg-primary/10 hover:bg-primary/20 border border-primary/30 text-primary rounded-full text-xs font-bold flex items-center justify-center gap-2 transition-all active:scale-[0.98] cursor-pointer"
            >
              <FaEnvelope className="text-xs" />
              <span>Create an account with email</span>
            </button>

            <p className="text-[11px] text-center text-secondary-text">
              Uses system credit balance. Ideal for credit pack purchases.
            </p>
          </div>
        ) : activeTab === "email" ? (
          <form onSubmit={handleEmailAuth} className="space-y-4 pt-2">
            {/* Sign in / create-account switch at the top of the form, so the
                sign-up path is visible without scrolling to the link below. */}
            <div className="flex bg-bg-page p-1 rounded-lg border border-divider/60">
              <button
                type="button"
                onClick={() => {
                  setEmailMode("signin");
                  setPasswordInput("");
                }}
                className={`flex-1 py-2 rounded-md text-xs font-bold transition-all ${
                  emailMode === "signin"
                    ? "bg-bg-card text-white shadow-sm border border-divider/40"
                    : "text-secondary-text hover:text-white"
                }`}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => {
                  setEmailMode("signup");
                  setPasswordInput("");
                }}
                className={`flex-1 py-2 rounded-md text-xs font-bold transition-all ${
                  emailMode === "signup"
                    ? "bg-bg-card text-white shadow-sm border border-divider/40"
                    : "text-secondary-text hover:text-white"
                }`}
              >
                Create Account
              </button>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="email"
                className="block text-[11px] uppercase font-bold text-secondary-text tracking-wider"
              >
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                placeholder="you@example.com"
                className="w-full bg-bg-page border border-divider rounded-lg px-3.5 py-2.5 text-xs text-white placeholder-secondary-text/50 focus:outline-none focus:border-primary transition-colors"
              />
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="password"
                className="block text-[11px] uppercase font-bold text-secondary-text tracking-wider"
              >
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete={emailMode === "signup" ? "new-password" : "current-password"}
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                placeholder={emailMode === "signup" ? "At least 8 characters" : "••••••••"}
                className="w-full bg-bg-page border border-divider rounded-lg px-3.5 py-2.5 text-xs text-white placeholder-secondary-text/50 focus:outline-none focus:border-primary transition-colors"
              />
              {emailMode === "signup" && (
                <p className="text-[10px] text-secondary-text leading-relaxed">
                  At least 8 characters. Longer beats complicated — avoid passwords
                  other people use.
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={isSubmitting || !emailInput.trim() || !passwordInput}
              className="w-full py-3 bg-primary hover:bg-primary/90 text-white rounded-full text-xs font-bold flex items-center justify-center gap-2 transition-all shadow-md active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              <span>
                {isSubmitting
                  ? "Please wait..."
                  : emailMode === "signup"
                    ? "Create Account"
                    : "Sign In"}
              </span>
              <FaArrowRight className="text-xs" />
            </button>

            <button
              type="button"
              onClick={() => {
                setEmailMode(emailMode === "signup" ? "signin" : "signup");
                setPasswordInput("");
              }}
              className="w-full text-center text-[11px] text-primary hover:underline font-semibold cursor-pointer"
            >
              {emailMode === "signup"
                ? "Already have an account? Sign in"
                : "Need an account? Create one"}
            </button>
          </form>
        ) : (
          <form onSubmit={handleApiKeyLogin} className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <label className="block text-[11px] uppercase font-bold text-secondary-text tracking-wider">
                MuAPI Key
              </label>
              <div className="relative">
                <input
                  type="password"
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  placeholder="Enter your mu_... key"
                  className="w-full bg-bg-page border border-divider rounded-lg px-3.5 py-2.5 text-xs text-white placeholder-secondary-text/50 focus:outline-none focus:border-primary transition-colors"
                />
              </div>
              <div className="flex justify-end">
                <a
                  href="https://muapi.ai"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] text-primary hover:underline font-semibold"
                >
                  Get API Key from MuAPI →
                </a>
              </div>
            </div>

            <button
              type="submit"
              disabled={isSubmitting || !apiKeyInput.trim()}
              className="w-full py-3 bg-primary hover:bg-primary/90 text-white rounded-full text-xs font-bold flex items-center justify-center gap-2 transition-all shadow-md active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              <span>{isSubmitting ? "Authenticating..." : "Sign In with API Key"}</span>
              <FaArrowRight className="text-xs" />
            </button>

            <p className="text-[11px] text-center text-amber-400/90 font-medium">
              ⚡ Simulates hairstyles using your API key. 0 website credits required!
            </p>
          </form>
        )}

        <div className="flex items-start gap-2.5 bg-primary/5 border border-primary/10 p-3.5 rounded text-[11px] leading-relaxed text-secondary-text">
          <FaInfoCircle className="text-primary text-xs shrink-0 mt-0.5" />
          <span>
            By signing in, you agree to our Terms of Service. API keys are kept secure and encrypted for generation calls.
          </span>
        </div>
      </div>
    </div>
  );
}

export default function Login() {
  return (
    <Suspense
      fallback={
        <div className="min-h-dvh flex items-center justify-center bg-bg-page text-primary-text">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <LoginContent />
    </Suspense>
  );
}
