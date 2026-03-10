/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as crons from "../crons.js";
import type * as games from "../games.js";
import type * as guests from "../guests.js";
import type * as lib from "../lib.js";
import type * as lobby from "../lobby.js";
import type * as matchmaking from "../matchmaking.js";
import type * as migrations from "../migrations.js";
import type * as presence from "../presence.js";
import type * as privacy from "../privacy.js";
import type * as privateGames from "../privateGames.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  crons: typeof crons;
  games: typeof games;
  guests: typeof guests;
  lib: typeof lib;
  lobby: typeof lobby;
  matchmaking: typeof matchmaking;
  migrations: typeof migrations;
  presence: typeof presence;
  privacy: typeof privacy;
  privateGames: typeof privateGames;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
