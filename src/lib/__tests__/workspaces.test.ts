import {describe,it,expect} from "vitest";
import {workspaceForPath,workspaceNav,isWorkspace} from "../workspaces";
import {getNavSection} from "../nav";
describe("workspace navigation",()=>{
 it("deep links override remembered workspace; common screens preserve it",()=>{
  expect(workspaceForPath("/lectures/record-id")).toBe("lectures");expect(workspaceForPath("/moai/templates")).toBe("moai");expect(workspaceForPath("/clients/abc/content")).toBe("optify");expect(workspaceForPath("/")).toBe("optify");
  for(const p of ["/assistant","/schedule","/settings","/lectures-old"])expect(workspaceForPath(p)).toBeNull();
 });
 it("isolates business menus while sharing assistant and calendar",()=>{
  for(const id of ["optify","moai","lectures"] as const){const paths=workspaceNav(id).map(n=>n.href);expect(paths).toContain("/assistant");expect(paths).toContain("/schedule");if(id!=="optify")expect(paths).not.toContain("/clients");if(id!=="lectures")expect(paths).not.toContain("/lectures");}
 });
 it("activates specific library destinations and keeps legacy client grouping",()=>{
  expect(getNavSection("/lectures/library",workspaceNav("lectures"))).toBe("/lectures/library");expect(getNavSection("/moai/templates",workspaceNav("moai"))).toBe("/moai/templates");expect(getNavSection("/lectures/id",workspaceNav("lectures"))).toBe("/lectures");expect(getNavSection("/clients/id/seo",workspaceNav("optify"))).toBe("/seo-geo");expect(getNavSection("/tasks",workspaceNav("optify"))).toBe("/");expect(isWorkspace("constructor")).toBe(false);
 });
});
