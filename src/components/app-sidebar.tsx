"use client"
import * as React from "react"
import { useRouter } from "next/navigation"
import { SquarePen, Folder } from "lucide-react"

import {
    Sidebar,
    SidebarContent,
    SidebarGroup,
    SidebarGroupContent,
    SidebarGroupLabel,
    SidebarHeader,
    SidebarMenu,
    SidebarMenuItem,
    SidebarMenuButton,
} from "@/components/ui/sidebar"

const historyItems = [
    {
        title: "มีคอมพิวเตอร์ว่างให้ยืมไหม",
        url: "#",
        icon: Folder,
    },
    {
        title: "วันนี้มีโต๊ะเหลือว่างให้ยืมบ้างไหม",
        url: "#",
        icon: Folder,
    },
]

export function AppSidebar() {
    const router = useRouter()
    return (
        <Sidebar side="right" variant="sidebar" className="border-l bg-white w-[360px] h-full">
            <SidebarHeader className="py-2">
                <div className="flex justify-center">
                    <button
                        onClick={() => router.push('/chat')}
                        className="w-[297px] h-[54px] text-base flex gap-3 items-center text-slate-800 hover:bg-slate-100 rounded-xl px-4 transition-colors"
                    >
                        <SquarePen className="w-5 h-5 shrink-0" />
                        <span>แชทใหม่</span>
                    </button>
                </div>
            </SidebarHeader>

            <SidebarContent>
                <SidebarGroup>
                    <SidebarGroupLabel className="text-xs font-medium text-slate-400 pl-[47px] py-2">
                        แชท
                    </SidebarGroupLabel>
                    <SidebarGroupContent>
                        <SidebarMenu className="px-0 flex flex-col items-center gap-1">
                            {historyItems.map((item) => (
                                <SidebarMenuItem key={item.title} className="w-[297px]">
                                    <SidebarMenuButton
                                        asChild
                                        className="w-[297px] h-[54px] flex gap-3 text-slate-700 hover:text-slate-900 hover:bg-slate-100 whitespace-normal text-sm items-center rounded-xl px-4"
                                    >
                                        <a href={item.url}>
                                            <item.icon className="w-5 h-5 shrink-0" />
                                            <span className="line-clamp-2 leading-snug">{item.title}</span>
                                        </a>
                                    </SidebarMenuButton>
                                </SidebarMenuItem>
                            ))}
                        </SidebarMenu>
                    </SidebarGroupContent>
                </SidebarGroup>
            </SidebarContent>
        </Sidebar>
    )
}
