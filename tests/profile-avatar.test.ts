import assert from "node:assert/strict";
import test from "node:test";
import {
  profileAvatarClasses,
  profileAvatarHtml,
} from "../src/lib/profileAvatar.ts";

test("Judah and Max have distinct profile avatar colors", () => {
  assert.match(profileAvatarClasses("judah"), /bg-blue-600/);
  assert.match(profileAvatarClasses("max"), /bg-emerald-600/);
});

test("profile avatars use the correct letters", () => {
  assert.match(profileAvatarHtml("judah"), />J<\/span>/);
  assert.match(profileAvatarHtml("max"), />M<\/span>/);
});
