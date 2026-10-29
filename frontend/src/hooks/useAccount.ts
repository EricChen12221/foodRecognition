// src/hooks/useAccount.ts
//
// App.tsx calls this ONCE and passes the result down. It owns the user's goals, profiles and
// daily totals, fills them from the signed-in account, and saves every edit through the API.
import { useEffect, useState } from 'react';
import { Alert } from 'react-native';
import type { DayTotals, Goals, Profile } from '../types';
import { DEFAULT_GOALS } from '../settings';
import * as api from '../services/data';
import type { Session } from '../services/session';

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));
const fail = (title: string, e: unknown) => Alert.alert(title, messageOf(e));

export function useAccount(session: Session | null) {
  const [goals, setGoals] = useState<Goals>(DEFAULT_GOALS);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [days, setDays] = useState<Record<string, DayTotals>>({});

  // When sign-in finishes, the account it returned already has everything: no extra requests.
  useEffect(() => {
    if (!session) return;
    setGoals(session.account.goals);
    setProfiles(session.account.profiles);
    setDays(api.toDaysMap(session.account.dailyMacros as api.DailyMacro[]));
  }, [session]);

  // goals
  const changeGoal = (key: keyof Goals, value: number) => {
    if (goals[key] === value) return;            // blurring a field without changing it sends nothing
    const before = goals;
    setGoals({ ...goals, [key]: value });
    api.updateGoals({ [key]: value } as Partial<Goals>)
      .then(setGoals)                            // then use the server's copy
      .catch((e) => { setGoals(before); fail("Couldn't save your goal", e); });
  };

  const resetGoals = () => {
    const before = goals;
    setGoals(DEFAULT_GOALS);
    api.updateGoals(DEFAULT_GOALS)
      .then(setGoals)
      .catch((e) => { setGoals(before); fail("Couldn't reset your goals", e); });
  };

  // profiles
  // Adding waits for the server, because the server chooses the new profile's id.
  const addProfile = () => {
    api.createProfile('New bowl', 0.2)
      .then((p) => setProfiles((now) => [...now, p]))
      .catch((e) => fail("Couldn't add a profile", e));
  };

  const changeProfile = (id: string, patch: { label?: string; diameter?: number }) => {
    const current = profiles.find((p) => p.id === id);
    if (!current) return;
    const unchanged =
      (patch.label === undefined || patch.label === current.label) &&
      (patch.diameter === undefined || patch.diameter === current.diameter);
    if (unchanged) return;

    const before = profiles;
    setProfiles(profiles.map((p) => (p.id === id ? { ...p, ...patch } : p)));
    api.updateProfile(id, patch)
      .then((saved) => setProfiles((now) => now.map((p) => (p.id === id ? saved : p))))
      .catch((e) => { setProfiles(before); fail("Couldn't save the profile", e); });
  };

  const deleteProfile = (id: string) => {
    const before = profiles;
    setProfiles(profiles.filter((p) => p.id !== id));
    api.deleteProfile(id)
      .then(setProfiles)                         // the server returns the remaining profiles
      .catch((e) => { setProfiles(before); fail("Couldn't delete the profile", e); });
  };

  return { goals, profiles, days, changeGoal, resetGoals, addProfile, changeProfile, deleteProfile };
}

export type AccountData = ReturnType<typeof useAccount>;