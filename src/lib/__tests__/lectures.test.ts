import { describe, it, expect } from "vitest";
import { emptyProject, projectInput, lectureCalendar, type LectureProject } from "../lectures/types";
const id="10000000-0000-4000-8000-000000000001";
const meeting={id,title:"1회차",date:"2026-11-15",start:"13:00",end:"15:00",location:"",confirmed:false,kind:"lecture"};
describe("lecture integrity",()=>{
 it("keeps incomplete proposals usable without inventing conditions",()=>{const p=projectInput({...emptyProject(),title:"제안 작성 중"});expect(p.sessions).toEqual([]);expect(p.organization).toBe("");expect(p.history_verified).toBe(false);});
 it("rejects invalid dates, half times and reversed times",()=>{for(const values of [{date:"2026-02-30"},{end:"12:00"},{end:""},{start:"25:00"}]) expect(()=>projectInput({...emptyProject(),title:"test",sessions:[{...meeting,...values}]})).toThrow();});
 it("requires a date for confirmation and completion for career history",()=>{expect(()=>projectInput({...emptyProject(),title:"test",sessions:[{...meeting,date:"",confirmed:true}]})).toThrow();expect(()=>projectInput({...emptyProject(),title:"test",history_verified:true})).toThrow();expect(projectInput({...emptyProject(),title:"test",stage:"completed",history_verified:true}).history_verified).toBe(true);});
 it("distinguishes tentative sessions and excludes archived or cancelled lectures",()=>{const p={...emptyProject(),id,title:"특강",sessions:[meeting],next_action:"초안 검토",next_action_date:"2026-11-10"} as LectureProject;expect(lectureCalendar([p])).toHaveLength(2);expect(lectureCalendar([p])[0].label).toContain("[가안]");expect(lectureCalendar([{...p,archived:true},{...p,stage:"cancelled"}])).toEqual([]);expect(lectureCalendar([{...p,stage:"completed"}])).toHaveLength(1);});
});
