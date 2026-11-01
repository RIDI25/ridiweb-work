import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { patchLectureProject, prepareLectureAction } from "../lecture-actions";
import { emptyProject, type LectureProject } from "@/lib/lectures/types";
import { safeAssistantHref } from "../lecture-links";
const id="10000000-0000-4000-8000-000000000001", sid="20000000-0000-4000-8000-000000000002", other="30000000-0000-4000-8000-000000000003";
const session={id:sid,title:"특강",date:"2026-11-12",start:"10:00",end:"12:00",location:"서울",confirmed:false,kind:"lecture" as const};
const project: LectureProject={...emptyProject(),id,owner_id:id,title:"실무 교육",organization:"교육원",brief:"보존할 메모",sessions:[session],version:4,updated_at:"2026-11-01"};
const doc={id,owner_id:id,project_id:null,kind:"profile",title:"소개",body:"기존 소개",status:"final",archived:false,version:2};
function database(tables:Record<string,unknown>={}, restricted=false) {
  return {from(table:string){const result={data:table==="ridiweb_access"?{scope:restricted?"moai":"full"}:table==="moai_members"?{role:"reviewer"}:tables[table]??null,error:null};const query={select(){return query;},eq(){return query;},ilike(){return query;},limit(){return query;},maybeSingle(){return Promise.resolve(result);},then:Promise.resolve(result).then.bind(Promise.resolve(result))};return query;}} as unknown as SupabaseClient;
}
describe("lecture assistant drafts",()=>{
  it("creates one draft with dates, checklist and full documents without business writes",async()=>{
    const r=await prepareLectureAction(database({lecture_projects:[]}),"create_lecture_project",{title:"새 의뢰",origin:"inquiry",sessions:[{title:"특강",date:session.date,start:session.start,end:session.end}],documents:[{kind:"proposal",title:"제안서",body:"전체 내용\n".repeat(400)}]},id);
    expect(r.payload.values).toMatchObject({stage:"expected",fee:"",history_verified:false,sessions:[expect.objectContaining({confirmed:false})]});
    expect(r.display.documents?.[0].body).toBe("전체 내용\n".repeat(400).trim());
    expect(r.display.fields.some(f=>f.label.includes("준비 항목"))).toBe(true);
  });
  it("merges only specified fields and explicitly removes by ID",()=>{
    const next=patchLectureProject({sessions:[{id:sid,start:"11:00",end:"13:00"},{title:"이동",kind:"travel",date:session.date,start:"09:00",end:"10:00"}],checklist:[{id:"check-0",done:true}]},project);
    expect(next.brief).toBe(project.brief);expect(next.sessions[0]).toEqual({...session,start:"11:00",end:"13:00"});expect(next.sessions).toHaveLength(2);expect(next.checklist).toHaveLength(7);expect(next.checklist[0].done).toBe(true);
    const removed=patchLectureProject({remove_session_ids:[sid],remove_checklist_ids:["check-0"]},project);expect(removed.sessions).toEqual([]);expect(removed.checklist).toHaveLength(6);
    expect(patchLectureProject({sessions:[]},project).sessions).toEqual([session]);
  });
  it("freezes version and shows old/new details and explicit removals",async()=>{
    const r=await prepareLectureAction(database({lecture_projects:project}),"update_lecture_project",{project_id:id,expected_version:4,sessions:[{id:sid,start:"11:00",end:"13:00"}],remove_checklist_ids:["check-0"]},id);
    expect(r.payload).toMatchObject({project_id:id,expected_version:4});expect(r.display.fields.find(f=>f.label==="일정 (한국) 변경")?.value).toMatch(/10:00–12:00[\s\S]+11:00–13:00/);expect(r.display.fields.some(f=>f.label==="준비 항목 제외")).toBe(true);
  });
  it("rejects invalid schedules, unknown IDs, contradictory patches and duplicate sessions",()=>{
    for(const change of [{sessions:[{id:other}]},{sessions:[{id:sid},{id:sid}]},{remove_session_ids:[other]},{sessions:[{id:sid}],remove_session_ids:[sid]},{sessions:[{id:sid,date:"2026-02-30"}]},{sessions:[{id:sid,end:"09:00"}]},{sessions:[{id:sid,end:""}]},{sessions:[{id:sid,confirmed:"yes"}]},{sessions:[{...session,id:undefined}]},{checklist:[null]}])expect(()=>patchLectureProject(change,project)).toThrow();
  });
  it("removes career verification when a completed lecture reopens",()=>{
    expect(patchLectureProject({stage:"preparing"},{...project,stage:"completed",history_verified:true}).history_verified).toBe(false);
    expect(()=>patchLectureProject({history_verified:true},project)).toThrow();
  });
  it("rejects duplicates, foreign ownership and restricted scope",async()=>{
    await expect(prepareLectureAction(database({lecture_projects:[{id}]}),"create_lecture_project",{title:"실무 교육",origin:"proposal"},id)).rejects.toThrow(/같은/);
    await expect(prepareLectureAction(database({lecture_projects:{...project,owner_id:other}}),"update_lecture_project",{project_id:id,expected_version:4,title:"수정"},id)).rejects.toThrow(/내 강의/);
    await expect(prepareLectureAction(database({},true),"create_lecture_project",{title:"제안",origin:"proposal"},id)).rejects.toThrow(/권한/);
  });
  it("keeps full before/after body and downgrades changed final documents",async()=>{
    const r=await prepareLectureAction(database({lecture_documents:doc}),"save_lecture_document",{document_id:id,expected_version:2,body:"새 소개"},id);
    expect(r.payload).toMatchObject({expected_version:2,project_id:null,values:{status:"draft",title:"소개",body:"새 소개"}});expect(r.display.documents?.[0]).toMatchObject({body:"새 소개",previousBody:"기존 소개"});
    await expect(prepareLectureAction(database({lecture_documents:doc}),"save_lecture_document",{document_id:id,expected_version:2,body:"새 소개",status:"final"},id)).rejects.toThrow(/먼저/);
    const final=await prepareLectureAction(database({lecture_documents:{...doc,status:"draft"}}),"save_lecture_document",{document_id:id,expected_version:2,status:"final"},id);expect(final.payload.values).toMatchObject({status:"final",body:doc.body});
  });
  it("copies own source into a new draft and restores only the target document's revision",async()=>{
    const copied=await prepareLectureAction(database({lecture_documents:doc}),"save_lecture_document",{source_document_id:id},id);expect(copied.payload.values).toMatchObject({kind:"profile",body:doc.body,status:"draft"});
    const revision={...doc,id:other,document_id:id,title:"前 소개",body:"이전 내용",version:1};
    const restored=await prepareLectureAction(database({lecture_documents:doc,lecture_document_revisions:revision}),"save_lecture_document",{document_id:id,expected_version:2,restore_revision_id:other},id);expect(restored.payload.values).toMatchObject({title:"前 소개",body:"이전 내용",status:"draft"});
    await expect(prepareLectureAction(database({lecture_documents:doc,lecture_document_revisions:{...revision,document_id:other}}),"save_lecture_document",{document_id:id,expected_version:2,restore_revision_id:other},id)).rejects.toThrow(/이 문서/);
    await expect(prepareLectureAction(database({lecture_documents:doc}),"save_lecture_document",{document_id:id,expected_version:2,kind:"curriculum"},id)).rejects.toThrow(/복사/);
  });
  it("archive and restore preserve document content; hyperlinks allow only internal lecture destinations",async()=>{
    for(const archived of [true,false]){const r=await prepareLectureAction(database({lecture_documents:{...doc,archived:!archived}}),"save_lecture_document",{document_id:id,expected_version:2,archived},id);expect(r.payload.values).toMatchObject({archived,body:doc.body,status:"final"});}
    expect(safeAssistantHref(`/lectures/profile?document=${id}`)).toBe(true);expect(safeAssistantHref(`/api/lectures/export?id=${id}&format=md`)).toBe(true);
    for(const url of ["javascript:alert(1)","//external.test","/api/lectures/delete?id="+id,"/lectures/profile?redirect=//evil"])expect(safeAssistantHref(url)).toBe(false);
  });
});

it("rejects bodies prepared against an older version before creating a confirmation draft",async()=>{
  await expect(prepareLectureAction(database({lecture_documents:doc}),"save_lecture_document",{document_id:id,expected_version:1,body:"old result"},id)).rejects.toThrow(/버전/);
  await expect(prepareLectureAction(database({lecture_projects:project}),"update_lecture_project",{project_id:id,expected_version:3,title:"old result"},id)).rejects.toThrow(/버전/);
});
