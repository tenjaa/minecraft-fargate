import {
  MatchStyle,
  expect as expectCDK,
  matchTemplate,
} from "@aws-cdk/assert";
import * as cdk from "@aws-cdk/core";
import * as Cdk from "../lib/minecraft-stack";

test("Empty Stack", () => {
  const app = new cdk.App();
  // WHEN
  const stack = new Cdk.MinecraftStack(app, "MyTestStack");
  // THEN
  expectCDK(stack).to(
    matchTemplate(
      {
        Resources: {},
      },
      MatchStyle.EXACT,
    ),
  );
});
