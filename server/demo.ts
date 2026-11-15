export const demo = {
 mode:'demo' as const,
 connections:[
  {id:'org-demo',account:'studio-demo',ownerType:'Organization',status:'connected'},
  {id:'personal-demo',account:'personal-demo',ownerType:'User',status:'connected'},
 ],
 repositories:[
  {id:'101',owner:'studio-demo',name:'MikroDash',fullName:'studio-demo/MikroDash',private:false,defaultBranch:'main',description:'إدارة شبكات MikroTik',url:'https://github.com/so7ob/MikroDash',connectionIds:['org-demo'],
   issues:[{id:'101-1',number:97,title:'توحيد واجهة إدارة المشتركين',state:'open',url:'https://github.com/so7ob/MikroDash/issues/97'},{id:'101-2',number:76,title:'قبول التشغيل على أجهزة الاختبار',state:'open',url:'https://github.com/so7ob/MikroDash/issues/76'},{id:'101-3',number:93,title:'معاينة الدليل في أحجام العرض المختلفة',state:'closed',stateReason:'completed',url:''},{id:'101-4',number:92,title:'قائمة المشتركين كواجهة أساسية',state:'closed',stateReason:'completed',url:''},{id:'101-5',number:85,title:'فصل الهيكل الجانبي',state:'closed',stateReason:'completed',url:''}],
   pulls:[{id:'101-p1',number:98,title:'توحيد الشجرة والقوائم',state:'closed',merged:true,url:'https://github.com/so7ob/MikroDash/pull/98',baseRef:'develop'}],
   runs:[{id:'101-r1',name:'Tests',status:'completed',conclusion:'success',branch:'develop',url:''}],releases:[{id:'101-v1',name:'v1.0.5',tag:'v1.0.5',url:'https://github.com/so7ob/MikroDash/releases/tag/v1.0.5'}],
   milestones:[{number:1,title:'إدارة المشتركين',state:'open',openIssues:2,closedIssues:3}],progress:{completed:3,total:5,percent:60,title:'إدارة المشتركين'},syncStatus:'demo'},
  {id:'102',owner:'studio-demo',name:'HUDA',fullName:'studio-demo/HUDA',private:false,defaultBranch:'main',description:'تطبيق القرآن والقراءة',url:'https://github.com/so7ob/HUDA',connectionIds:['org-demo'],
   issues:[{id:'102-1',number:17,title:'تهيئة بيئة النشر الإنتاجي',state:'open',url:'https://github.com/so7ob/HUDA/issues/17'}],pulls:[],runs:[],releases:[],milestones:[],progress:null,syncStatus:'demo'},
  {id:'103',owner:'personal-demo',name:'FieldNotes',fullName:'personal-demo/FieldNotes',private:true,defaultBranch:'main',description:'مساحة تجريبية لمتابعة الملاحظات',url:'',connectionIds:['personal-demo'],
   issues:[],pulls:[],runs:[],releases:[],milestones:[],progress:null,syncStatus:'demo'},
 ],
 syncErrors:[],
};
