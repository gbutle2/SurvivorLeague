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
export type ConversationType = "league" | "direct";
export type MessageKind = "user" | "system";
export type LeagueEventType =
  | "pick_submitted"
  | "pick_updated"
  | "commissioner_pick_changed"
  | "week_opened"
  | "week_locked"
  | "picks_revealed"
  | "result_entered"
  | "result_corrected"
  | "survivor_eliminated"
  | "season_activated"
  | "season_deactivated"
  | "member_added"
  | "member_removed"
  | "commissioner_announcement";
export type NotificationType =
  | "direct_message"
  | "commissioner_pick_changed"
  | "week_opened"
  | "week_locked"
  | "commissioner_announcement"
  | "survivor_eliminated";

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
      commissioner_pick_override_audits: {
        Row: {
          id: string;
          commissioner_user_id: string;
          target_user_id: string;
          league_id: string;
          season_id: string;
          week_id: string;
          week_number: number;
          previous_team_id: string | null;
          previous_game_id: string | null;
          previous_result: PickResult | null;
          previous_points: number | null;
          new_team_id: string | null;
          new_game_id: string | null;
          new_result: PickResult | null;
          new_points: number | null;
          cleared: boolean;
          reason: string;
          overridden_at: string;
        };
        Insert: {
          id?: string;
          commissioner_user_id: string;
          target_user_id: string;
          league_id: string;
          season_id: string;
          week_id: string;
          week_number: number;
          previous_team_id?: string | null;
          previous_game_id?: string | null;
          previous_result?: PickResult | null;
          previous_points?: number | null;
          new_team_id?: string | null;
          new_game_id?: string | null;
          new_result?: PickResult | null;
          new_points?: number | null;
          cleared?: boolean;
          reason: string;
          overridden_at?: string;
        };
        Update: {
          id?: string;
          commissioner_user_id?: string;
          target_user_id?: string;
          league_id?: string;
          season_id?: string;
          week_id?: string;
          week_number?: number;
          previous_team_id?: string | null;
          previous_game_id?: string | null;
          previous_result?: PickResult | null;
          previous_points?: number | null;
          new_team_id?: string | null;
          new_game_id?: string | null;
          new_result?: PickResult | null;
          new_points?: number | null;
          cleared?: boolean;
          reason?: string;
          overridden_at?: string;
        };
        Relationships: [];
      };
      conversations: {
        Row: {
          id: string;
          league_id: string;
          type: ConversationType;
          dm_user_low: string | null;
          dm_user_high: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          league_id: string;
          type: ConversationType;
          dm_user_low?: string | null;
          dm_user_high?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          league_id?: string;
          type?: ConversationType;
          dm_user_low?: string | null;
          dm_user_high?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      messages: {
        Row: {
          id: string;
          conversation_id: string;
          league_id: string;
          kind: MessageKind;
          author_user_id: string | null;
          author_display_name: string | null;
          body: string | null;
          league_event_id: string | null;
          created_at: string;
          edited_at: string | null;
          deleted_at: string | null;
          client_idempotency_key: string | null;
          system_idempotency_key: string | null;
        };
        Insert: {
          id?: string;
          conversation_id: string;
          league_id: string;
          kind: MessageKind;
          author_user_id?: string | null;
          author_display_name?: string | null;
          body?: string | null;
          league_event_id?: string | null;
          created_at?: string;
          edited_at?: string | null;
          deleted_at?: string | null;
          client_idempotency_key?: string | null;
          system_idempotency_key?: string | null;
        };
        Update: {
          id?: string;
          conversation_id?: string;
          league_id?: string;
          kind?: MessageKind;
          author_user_id?: string | null;
          author_display_name?: string | null;
          body?: string | null;
          league_event_id?: string | null;
          created_at?: string;
          edited_at?: string | null;
          deleted_at?: string | null;
          client_idempotency_key?: string | null;
          system_idempotency_key?: string | null;
        };
        Relationships: [];
      };
      league_events: {
        Row: {
          id: string;
          league_id: string;
          season_id: string | null;
          week_id: string | null;
          event_type: LeagueEventType;
          actor_user_id: string | null;
          affected_user_id: string | null;
          actor_display_name: string | null;
          affected_display_name: string | null;
          domain_table: string | null;
          domain_record_id: string | null;
          payload: Json;
          sensitive_payload: Json;
          is_revealed: boolean;
          created_at: string;
          idempotency_key: string;
        };
        Insert: {
          id?: string;
          league_id: string;
          season_id?: string | null;
          week_id?: string | null;
          event_type: LeagueEventType;
          actor_user_id?: string | null;
          affected_user_id?: string | null;
          actor_display_name?: string | null;
          affected_display_name?: string | null;
          domain_table?: string | null;
          domain_record_id?: string | null;
          payload?: Json;
          sensitive_payload?: Json;
          is_revealed?: boolean;
          created_at?: string;
          idempotency_key: string;
        };
        Update: {
          id?: string;
          league_id?: string;
          season_id?: string | null;
          week_id?: string | null;
          event_type?: LeagueEventType;
          actor_user_id?: string | null;
          affected_user_id?: string | null;
          actor_display_name?: string | null;
          affected_display_name?: string | null;
          domain_table?: string | null;
          domain_record_id?: string | null;
          payload?: Json;
          sensitive_payload?: Json;
          is_revealed?: boolean;
          created_at?: string;
          idempotency_key?: string;
        };
        Relationships: [];
      };
      conversation_read_states: {
        Row: {
          conversation_id: string;
          user_id: string;
          last_read_at: string;
          last_read_message_id: string | null;
          updated_at: string;
        };
        Insert: {
          conversation_id: string;
          user_id: string;
          last_read_at?: string;
          last_read_message_id?: string | null;
          updated_at?: string;
        };
        Update: {
          conversation_id?: string;
          user_id?: string;
          last_read_at?: string;
          last_read_message_id?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      notifications: {
        Row: {
          id: string;
          recipient_user_id: string;
          league_id: string;
          notification_type: NotificationType;
          title: string;
          body: string;
          payload: Json;
          link_path: string | null;
          created_at: string;
          read_at: string | null;
          idempotency_key: string;
        };
        Insert: {
          id?: string;
          recipient_user_id: string;
          league_id: string;
          notification_type: NotificationType;
          title: string;
          body: string;
          payload?: Json;
          link_path?: string | null;
          created_at?: string;
          read_at?: string | null;
          idempotency_key: string;
        };
        Update: {
          id?: string;
          recipient_user_id?: string;
          league_id?: string;
          notification_type?: NotificationType;
          title?: string;
          body?: string;
          payload?: Json;
          link_path?: string | null;
          created_at?: string;
          read_at?: string | null;
          idempotency_key?: string;
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
      commissioner_override_pick: {
        Args: {
          p_target_user_id: string;
          p_week_id: string;
          p_team_id?: string | null;
          p_reason: string;
          p_submitted_requester_id?: string | null;
          p_submitted_league_id?: string | null;
          p_submitted_role?: string | null;
          p_submitted_result?: PickResult | null;
          p_submitted_points?: number | null;
          p_submitted_game_id?: string | null;
        };
        Returns: Json;
      };
      commissioner_list_week_picks: {
        Args: { p_week_id: string };
        Returns: {
          user_id: string;
          display_name: string;
          pick_id: string | null;
          team_id: string | null;
          team_abbreviation: string | null;
          team_city: string | null;
          team_name: string | null;
          game_id: string | null;
          result: PickResult | null;
          points: number;
          submitted_at: string | null;
          updated_at: string | null;
          last_override_at: string | null;
          last_override_reason: string | null;
          last_override_by: string | null;
          used_elsewhere: Json;
        }[];
      };
      commissioner_preview_pick_override: {
        Args: { p_week_id: string; p_team_id: string };
        Returns: Json;
      };
      regular_pick_points_for_result: {
        Args: { p_result: PickResult; p_season_id: string };
        Returns: number;
      };
      is_conversation_participant: {
        Args: { p_conversation_id: string };
        Returns: boolean;
      };
      ensure_league_conversation: {
        Args: { p_league_id: string };
        Returns: string;
      };
      ensure_direct_conversation: {
        Args: { p_league_id: string; p_other_user_id: string };
        Returns: string;
      };
      send_conversation_message: {
        Args: {
          p_conversation_id: string;
          p_body: string;
          p_idempotency_key?: string | null;
        };
        Returns: {
          id: string;
          conversation_id: string;
          league_id: string;
          kind: MessageKind;
          author_user_id: string | null;
          author_display_name: string | null;
          body: string | null;
          league_event_id: string | null;
          created_at: string;
          edited_at: string | null;
          deleted_at: string | null;
          client_idempotency_key: string | null;
          system_idempotency_key: string | null;
        };
      };
      edit_own_message: {
        Args: { p_message_id: string; p_body: string };
        Returns: {
          id: string;
          conversation_id: string;
          league_id: string;
          kind: MessageKind;
          author_user_id: string | null;
          author_display_name: string | null;
          body: string | null;
          league_event_id: string | null;
          created_at: string;
          edited_at: string | null;
          deleted_at: string | null;
          client_idempotency_key: string | null;
          system_idempotency_key: string | null;
        };
      };
      soft_delete_own_message: {
        Args: { p_message_id: string };
        Returns: {
          id: string;
          conversation_id: string;
          league_id: string;
          kind: MessageKind;
          author_user_id: string | null;
          author_display_name: string | null;
          body: string | null;
          league_event_id: string | null;
          created_at: string;
          edited_at: string | null;
          deleted_at: string | null;
          client_idempotency_key: string | null;
          system_idempotency_key: string | null;
        };
      };
      reveal_eligible_pick_events: {
        Args: Record<string, never>;
        Returns: number;
      };
      mark_conversation_read: {
        Args: {
          p_conversation_id: string;
          p_message_id?: string | null;
        };
        Returns: undefined;
      };
      mark_notification_read: {
        Args: { p_notification_id: string };
        Returns: undefined;
      };
      mark_all_notifications_read: {
        Args: { p_league_id: string };
        Returns: number;
      };
      week_allows_player_picks: {
        Args: { p_week_id: string };
        Returns: boolean;
      };
      week_pick_submission_status: {
        Args: { p_week_id: string };
        Returns: {
          user_id: string;
          has_pick: boolean;
          currently_commissioner_overridden: boolean;
        }[];
      };
    };
    Enums: {
      member_role: MemberRole;
      pick_result: PickResult;
      week_status: WeekStatus;
      season_status: SeasonStatus;
      round_status: RoundStatus;
      conversation_type: ConversationType;
      message_kind: MessageKind;
      league_event_type: LeagueEventType;
      notification_type: NotificationType;
    };
    CompositeTypes: Record<string, never>;
  };
};
