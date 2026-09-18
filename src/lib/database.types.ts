export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type MemberRole = "commissioner" | "player";
export type PickResult = "pending" | "win" | "loss" | "tie";
export type WeekStatus = "upcoming" | "open" | "locked" | "final";
export type SeasonStatus = "setup" | "active" | "complete";
export type RoundStatus = "upcoming" | "open" | "locked" | "final";
export type NflSeasonType = "regular" | "postseason";
export type NflGameStatus =
  | "scheduled"
  | "in_progress"
  | "final"
  | "postponed"
  | "canceled";
export type PlayoffRoundCode =
  | "wildcard"
  | "divisional"
  | "conference"
  | "superbowl";
export type SyncRunStatus = "running" | "succeeded" | "failed" | "rejected";
export type PickResultSource = "auto" | "commissioner";
export type ScheduleReviewKind =
  | "post_kickoff_time_change"
  | "canceled_game"
  | "manual_override_required"
  | "unknown_team"
  | "other";

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          display_name: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          display_name: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          display_name?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      leagues: {
        Row: {
          id: string;
          name: string;
          slug: string;
          timezone: string;
          commissioner_user_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          timezone?: string;
          commissioner_user_id: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          slug?: string;
          timezone?: string;
          commissioner_user_id?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      league_members: {
        Row: {
          league_id: string;
          user_id: string;
          role: MemberRole;
          active: boolean;
          joined_at: string;
        };
        Insert: {
          league_id: string;
          user_id: string;
          role?: MemberRole;
          active?: boolean;
          joined_at?: string;
        };
        Update: {
          league_id?: string;
          user_id?: string;
          role?: MemberRole;
          active?: boolean;
          joined_at?: string;
        };
        Relationships: [];
      };
      seasons: {
        Row: {
          id: string;
          league_id: string;
          year: number;
          regular_week_count: number;
          status: SeasonStatus;
          season_complete: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          league_id: string;
          year: number;
          regular_week_count?: number;
          status?: SeasonStatus;
          season_complete?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          league_id?: string;
          year?: number;
          regular_week_count?: number;
          status?: SeasonStatus;
          season_complete?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      teams: {
        Row: {
          id: string;
          abbreviation: string;
          city: string;
          name: string;
          conference: string;
          division: string;
          active: boolean;
        };
        Insert: {
          id?: string;
          abbreviation: string;
          city: string;
          name: string;
          conference: string;
          division: string;
          active?: boolean;
        };
        Update: {
          id?: string;
          abbreviation?: string;
          city?: string;
          name?: string;
          conference?: string;
          division?: string;
          active?: boolean;
        };
        Relationships: [];
      };
      weeks: {
        Row: {
          id: string;
          season_id: string;
          week_number: number;
          label: string;
          locks_at: string;
          status: WeekStatus;
        };
        Insert: {
          id?: string;
          season_id: string;
          week_number: number;
          label: string;
          locks_at: string;
          status?: WeekStatus;
        };
        Update: {
          id?: string;
          season_id?: string;
          week_number?: number;
          label?: string;
          locks_at?: string;
          status?: WeekStatus;
        };
        Relationships: [];
      };
      picks: {
        Row: {
          id: string;
          week_id: string;
          user_id: string;
          team_id: string;
          submitted_at: string;
          updated_at: string;
          result: PickResult;
          result_source: PickResultSource;
          result_override_reason: string | null;
          game_id: string | null;
        };
        Insert: {
          id?: string;
          week_id: string;
          user_id: string;
          team_id: string;
          submitted_at?: string;
          updated_at?: string;
          result?: PickResult;
          result_source?: PickResultSource;
          result_override_reason?: string | null;
          game_id?: string | null;
        };
        Update: {
          id?: string;
          week_id?: string;
          user_id?: string;
          team_id?: string;
          submitted_at?: string;
          updated_at?: string;
          result?: PickResult;
          result_source?: PickResultSource;
          result_override_reason?: string | null;
          game_id?: string | null;
        };
        Relationships: [];
      };
      playoff_rounds: {
        Row: {
          id: string;
          season_id: string;
          round_number: number;
          round_code: PlayoffRoundCode | null;
          name: string;
          points: number;
          locks_at: string;
          status: RoundStatus;
        };
        Insert: {
          id?: string;
          season_id: string;
          round_number: number;
          round_code?: PlayoffRoundCode | null;
          name: string;
          points: number;
          locks_at: string;
          status?: RoundStatus;
        };
        Update: {
          id?: string;
          season_id?: string;
          round_number?: number;
          round_code?: PlayoffRoundCode | null;
          name?: string;
          points?: number;
          locks_at?: string;
          status?: RoundStatus;
        };
        Relationships: [];
      };
      playoff_picks: {
        Row: {
          id: string;
          playoff_round_id: string;
          user_id: string;
          team_id: string;
          submitted_at: string;
          updated_at: string;
          result: PickResult;
          points_awarded: number;
          result_source: PickResultSource;
          result_override_reason: string | null;
          game_id: string | null;
        };
        Insert: {
          id?: string;
          playoff_round_id: string;
          user_id: string;
          team_id: string;
          submitted_at?: string;
          updated_at?: string;
          result?: PickResult;
          points_awarded?: number;
          result_source?: PickResultSource;
          result_override_reason?: string | null;
          game_id?: string | null;
        };
        Update: {
          id?: string;
          playoff_round_id?: string;
          user_id?: string;
          team_id?: string;
          submitted_at?: string;
          updated_at?: string;
          result?: PickResult;
          points_awarded?: number;
          result_source?: PickResultSource;
          result_override_reason?: string | null;
          game_id?: string | null;
        };
        Relationships: [];
      };
      games: {
        Row: {
          id: string;
          provider: string;
          provider_game_id: string;
          season_year: number;
          season_type: NflSeasonType;
          regular_week_number: number | null;
          playoff_round: PlayoffRoundCode | null;
          home_team_id: string;
          away_team_id: string;
          scheduled_kickoff_at: string;
          status: NflGameStatus;
          home_score: number | null;
          away_score: number | null;
          winner_team_id: string | null;
          provider_updated_at: string | null;
          last_synced_at: string;
          manual_override: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          provider?: string;
          provider_game_id: string;
          season_year: number;
          season_type: NflSeasonType;
          regular_week_number?: number | null;
          playoff_round?: PlayoffRoundCode | null;
          home_team_id: string;
          away_team_id: string;
          scheduled_kickoff_at: string;
          status?: NflGameStatus;
          home_score?: number | null;
          away_score?: number | null;
          winner_team_id?: string | null;
          provider_updated_at?: string | null;
          last_synced_at?: string;
          manual_override?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          provider?: string;
          provider_game_id?: string;
          season_year?: number;
          season_type?: NflSeasonType;
          regular_week_number?: number | null;
          playoff_round?: PlayoffRoundCode | null;
          home_team_id?: string;
          away_team_id?: string;
          scheduled_kickoff_at?: string;
          status?: NflGameStatus;
          home_score?: number | null;
          away_score?: number | null;
          winner_team_id?: string | null;
          provider_updated_at?: string | null;
          last_synced_at?: string;
          manual_override?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      schedule_sync_runs: {
        Row: {
          id: string;
          provider: string;
          season_year: number;
          started_at: string;
          completed_at: string | null;
          status: SyncRunStatus;
          inserted_count: number;
          updated_count: number;
          skipped_count: number;
          rejected_count: number;
          source_freshness_at: string | null;
          error_summary: string | null;
          warning_summary: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          provider?: string;
          season_year: number;
          started_at?: string;
          completed_at?: string | null;
          status?: SyncRunStatus;
          inserted_count?: number;
          updated_count?: number;
          skipped_count?: number;
          rejected_count?: number;
          source_freshness_at?: string | null;
          error_summary?: string | null;
          warning_summary?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          provider?: string;
          season_year?: number;
          started_at?: string;
          completed_at?: string | null;
          status?: SyncRunStatus;
          inserted_count?: number;
          updated_count?: number;
          skipped_count?: number;
          rejected_count?: number;
          source_freshness_at?: string | null;
          error_summary?: string | null;
          warning_summary?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      schedule_review_items: {
        Row: {
          id: string;
          season_year: number;
          game_id: string | null;
          provider_game_id: string | null;
          kind: ScheduleReviewKind;
          summary: string;
          old_value: string | null;
          new_value: string | null;
          resolved: boolean;
          resolved_at: string | null;
          resolved_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          season_year: number;
          game_id?: string | null;
          provider_game_id?: string | null;
          kind: ScheduleReviewKind;
          summary: string;
          old_value?: string | null;
          new_value?: string | null;
          resolved?: boolean;
          resolved_at?: string | null;
          resolved_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          season_year?: number;
          game_id?: string | null;
          provider_game_id?: string | null;
          kind?: ScheduleReviewKind;
          summary?: string;
          old_value?: string | null;
          new_value?: string | null;
          resolved?: boolean;
          resolved_at?: string | null;
          resolved_by?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      scoring_rules: {
        Row: {
          season_id: string;
          correct_regular_pick_points: number;
          best_record_bonus: number;
          longest_streak_bonus: number;
          survivor_bonus: number;
          wildcard_points: number;
          divisional_points: number;
          conference_points: number;
          superbowl_points: number;
          perfect_season_override: boolean;
        };
        Insert: {
          season_id: string;
          correct_regular_pick_points?: number;
          best_record_bonus?: number;
          longest_streak_bonus?: number;
          survivor_bonus?: number;
          wildcard_points?: number;
          divisional_points?: number;
          conference_points?: number;
          superbowl_points?: number;
          perfect_season_override?: boolean;
        };
        Update: {
          season_id?: string;
          correct_regular_pick_points?: number;
          best_record_bonus?: number;
          longest_streak_bonus?: number;
          survivor_bonus?: number;
          wildcard_points?: number;
          divisional_points?: number;
          conference_points?: number;
          superbowl_points?: number;
          perfect_season_override?: boolean;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      is_active_league_member: {
        Args: { p_league_id: string };
        Returns: boolean;
      };
      is_league_commissioner: {
        Args: { p_league_id: string };
        Returns: boolean;
      };
      shares_league_with: {
        Args: { p_user_id: string };
        Returns: boolean;
      };
    };
    Enums: {
      member_role: MemberRole;
      pick_result: PickResult;
      week_status: WeekStatus;
      season_status: SeasonStatus;
      round_status: RoundStatus;
    };
    CompositeTypes: Record<string, never>;
  };
};
